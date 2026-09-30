const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const http = require('http');

// --- MINI SERWER HTTP DLA UPTIMEROBOTA ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Discord dziala 24/7!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Mini serwer HTTP dziala na porcie ${PORT}`);
});
// ----------------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = '!';
const DB_FILE = './database.json';

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { matches: {}, users: {}, settings: { locked: false, lockTime: null }, nextMatchId: 1 };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.settings) data.settings = { locked: false, lockTime: null };
    if (!data.nextMatchId) data.nextMatchId = 1;
    return data;
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Funkcja wyciągająca czysty wynik (np. "2-0")
function extractScore(text) {
    if (!text) return null;
    const match = text.toString().match(/\d+[-:]\d+/);
    return match ? match[0].replace(':', '-') : null;
}

// Określa zwycięzcę na podstawie wyniku: 'left' (gospodarz), 'right' (gość), 'draw' (remis)
function getWinnerFromScore(scoreStr) {
    if (!scoreStr) return null;
    const parts = scoreStr.split(/[-:]/);
    if (parts.length !== 2) return null;
    const left = parseInt(parts[0], 10);
    const right = parseInt(parts[1], 10);
    if (isNaN(left) || isNaN(right)) return null;
    if (left > right) return 'left';
    if (right > left) return 'right';
    return 'draw';
}

// Automatyczne zamykanie meczów co 60 sekund
setInterval(() => {
    const db = loadDB();
    let modified = false;
    const now = new Date();

    if (!db.settings.locked && db.settings.lockTime) {
        const targetTime = new Date(db.settings.lockTime);
        if (now >= targetTime) {
            db.settings.locked = true;
            db.settings.lockTime = null;
            modified = true;
            
            client.guilds.cache.forEach(guild => {
                const channel = guild.channels.cache.find(ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                if (channel) {
                    channel.send('🔒 **Automatyczne zamknięcie (globalne):** Czas minął! Wszystkie typy zostały zablokowane.');
                }
            });
        }
    }

    for (const mId in db.matches) {
        const match = db.matches[mId];
        if (!match.locked && match.lockTime) {
            const matchTargetTime = new Date(match.lockTime);
            if (now >= matchTargetTime) {
                match.locked = true;
                match.lockTime = null;
                modified = true;

                client.guilds.cache.forEach(guild => {
                    const channel = guild.channels.cache.find(ch => ch.isTextBased() && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
                    if (channel) {
                        channel.send(`🔒 **Automatyczne zamknięcie:** Czas na typowanie meczu **ID ${mId}** (${match.details}) minął! Mecz został zablokowany.`);
                    }
                });
            }
        }
    }

    if (modified) saveDB(db);
}, 60000);

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}! Bot gotowy.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const db = loadDB();

    // --- POMOC / KOMENDY ---
    if (command === 'komendy' || command === 'pomoc') {
        const embed = new EmbedBuilder()
            .setTitle('📖 Lista komend bota e-sportowego')
            .setColor(0x0099FF)
            .addFields(
                { 
                    name: '⚔️ Komendy dla graczy', 
                    value: 
                        '`!mecze` - Wyświetla listę aktywnych meczów, ich ID i terminy zamknięcia\n' +
                        '`!typ [ID] [Twój typ]` - Obstawiasz wynik konkretnego meczu (np. `!typ 1 2-1`)\n' +
                        '`!mojetypy` - Pokazuje Twoje aktualne typy\n' +
                        '`!profil` (lub `!statystyki`) - Wyświetla Twój profil gracza, punkty i statystyki trafień\n' +
                        '`!historia` - Sprawdza Twoją pełną historię typów\n' +
                        '`!prywatnykanal` - Tworzy Twój osobisty, prywatny wątek na serwerze'
                },
                { 
                    name: '🛡️ Komendy dla administratora', 
                    value: 
                        '`!dodajmecz [Nazwa]` - Automatycznie dodaje kolejny mecz\n' +
                        '`!edytujmecz [ID] [Nowa nazwa]` - Zmienia nazwę meczu\n' +
                        '`!usunmecz [ID]` - Usuwa wskazany mecz\n' +
                        '`!zamknij` / `!otwórz` - Blokuje/odblokowuje typowanie globalnie\n' +
                        '`!zamknijmecz [ID] [HH:MM]` - Automatyczne zamknięcie konkretnego meczu\n' +
                        '`!rozlicz [ID] [Wynik]` - Rozlicza mecz i przyznaje punkty\n' +
                        '`!naprawpunkty [ID] [Wynik]` - Służy do poprawienia rozliczenia\n' +
                        '`!ranking` (lub `!punkty`) - Wyświetla tabelę najlepszych graczy\n' +
                        '`!resetranking` - Resetuje ranking i statystyki'
                }
            );
        return message.reply({ embeds: [embed] });
    }

    // --- ADMIN: DODAJ MECZ ---
    if (command === 'dodajmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchDetails = args.join(' ');
        if (!matchDetails) return message.reply('❌ Użycie: `!dodajmecz [Nazwa]` (np. `!dodajmecz Faze vs zombies`)');
        
        const matchId = db.nextMatchId.toString();
        db.nextMatchId++;

        db.matches[matchId] = { details: matchDetails, locked: false, lockTime: null };
        saveDB(db);
        return message.reply(`✅ Dodano mecz z automatycznym ID: **${matchId}** (${matchDetails}).`);
    }

    // --- ADMIN: EDYTUJ MECZ ---
    if (command === 'edytujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const newDetails = args.slice(1).join(' ');
        if (!matchId || !newDetails || !db.matches[matchId]) return message.reply('❌ Użycie: `!edytujmecz [ID] [Nowa nazwa]`');

        db.matches[matchId].details = newDetails;
        saveDB(db);
        return message.reply(`✏️ Zaktualizowano nazwę meczu ID **${matchId}** na: *${newDetails}*`);
    }

    // --- ADMIN: USUN MECZ ---
    if (command === 'usunmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !db.matches[matchId]) return message.reply('❌ Podaj poprawne ID istniejącego meczu!');

        delete db.matches[matchId];
        saveDB(db);
        return message.reply(`🗑️ Usunięto mecz o ID: **${matchId}**`);
    }

    // --- ADMIN: ZAMKNIJ / OTWÓRZ GLOBALNIE ---
    if (command === 'zamknij') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = true;
        saveDB(db);
        return message.reply('🔒 Zablokowano typowanie globalnie dla wszystkich meczów.');
    }

    if (command === 'otwórz' || command === 'otworz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = false;
        saveDB(db);
        return message.reply('🔓 Odblokowano typowanie globalnie.');
    }

    // --- ADMIN: ZAMKNIJ MECZ (CZASOWO) ---
    if (command === 'zamknijmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const timeStr = args[1]; // np. 21:30

        if (!matchId || !timeStr || !db.matches[matchId]) {
            return message.reply('❌ Użycie: `!zamknijmecz [ID] [HH:MM]` (czas w formacie 24h, np. `!zamknijmecz 1 20:45`)');
        }

        const [hours, minutes] = timeStr.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return message.reply('❌ Błędny format godziny! Użyj np. `20:45`.');

        const now = new Date();
        const targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);

        if (targetTime <= now) {
            targetTime.setDate(targetTime.getDate() + 1); // Jeśli godzina już minęła dzisiaj, ustaw na jutro
        }

        db.matches[matchId].lockTime = targetTime.toISOString();
        saveDB(db);
        return message.reply(`⏳ Mecz ID **${matchId}** automatycznie zamknie się o godzinie **${timeStr}**.`);
    }

    // --- ADMIN: RESET RANKING ---
    if (command === 'resetranking') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.users = {};
        db.matches = {};
        db.nextMatchId = 1;
        db.settings.locked = false;
        db.settings.lockTime = null;
        saveDB(db);
        return message.reply('🔄 Zresetowano całą bazę danych i ranking.');
    }

    // --- RANKING ---
    if (command === 'ranking' || command === 'punkty') {
        const sorted = Object.entries(db.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
        if (sorted.length === 0) return message.reply('🏆 Tabela rankingowa jest pusta.');
        
        let desc = '';
        sorted.forEach(([id, data], i) => {
            let m = `${i+1}.`;
            if (i === 0) m = '🥇'; if (i === 1) m = '🥈'; if (i === 2) m = '🥉';
            desc += `${m} <@${id}> — **${data.points || 0} pkt**\n`;
        });
        const embed = new EmbedBuilder().setTitle('🏆 Tabela Wyników').setDescription(desc).setColor(0xFFD700);
        return message.reply({ embeds: [embed] });
    }

    // --- ADMIN: ROZLICZ / NAPRAW PUNKTY ---
    if (command === 'rozlicz' || command === 'naprawpunkty') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        
        const matchId = args[0];
        const rawInput = args.slice(1).join(' ');
        
        if (!matchId || !rawInput) return message.reply(`❌ Użycie: \`!${command} [ID] [Wynik]\` (np. \`!${command} 1 2-1\`)`);

        const officialScore = extractScore(rawInput);
        if (!officialScore) return message.reply('❌ Nie znaleziono poprawnego wyniku (np. `2-1`, `2-0`) w poleceniu!');

        const officialWinner = getWinnerFromScore(officialScore);
        let resultsSummary = `⚔️ **Rozliczenie meczu ID: ${matchId}**\n🏆 Oficjalny wynik: **${officialScore}**\n\n`;
        let count = 0;

        for (const userId in db.users) {
            const user = db.users[userId];
            const playerPred = user.predictions ? user.predictions[matchId] : null;
            if (!playerPred) continue;
            count++;
            
            if (user.points === undefined) user.points = 0;
            if (user.exactHits === undefined) user.exactHits = 0;
            if (user.winnerHits === undefined) user.winnerHits = 0;
            if (user.settledCount === undefined) user.settledCount = 0;

            user.settledCount += 1;

            const playerScores = extractScore(playerPred);
            const playerWinner = getWinnerFromScore(playerScores);

            let hitType = '';

            // 1. Dokładny wynik (3 pkt)
            if (playerScores && playerScores === officialScore) {
                user.points += 3;
                user.exactHits += 1;
                hitType = `🎯 Trafił **dokładny wynik** (${playerPred})! **+3 pkt**`;
            } 
            // 2. Trafiony zwycięzca (1 pkt)
            else if (playerWinner && officialWinner && playerWinner === officialWinner) {
                user.points += 1;
                user.winnerHits += 1;
                hitType = `✅ Trafił **zwycięzcę** (${playerPred})! **+1 pkt**`;
            } 
            // 3. Pudło (0 pkt)
            else {
                hitType = `❌ Pomylił się (${playerPred}). 0 pkt`;
            }

            resultsSummary += `<@${userId}>: ${hitType}\n`;
        }

        saveDB(db);
        if (count === 0) return message.reply(`⚠️ Żaden użytkownik nie obstawił meczu ID ${matchId}.`);
        return message.channel.send(resultsSummary);
    }

    // --- GRACZ: MECZE ---
    if (command === 'mecze') {
        const matchKeys = Object.keys(db.matches);
        if (matchKeys.length === 0) return message.reply('📌 Brak aktywnych meczów.');
        let desc = '';
        for (const mId of matchKeys) {
            const m = db.matches[mId];
            let lockInfo = m.locked ? ' (🔒 Zamknięty)' : '';
            if (m.lockTime) {
                const timeOnly = new Date(m.lockTime).toLocaleTimeString([], { hour: '2-2-digit' ? '2-digit' : '2-digit', minute: '2-digit' });
                lockInfo = ` (⏳ do ${timeOnly})`;
            }
            desc += `• **ID ${mId}**: ${m.details}${lockInfo}\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Lista aktywnych meczów').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    // --- GRACZ: TYP ---
    if (command === 'typ') {
        if (db.settings.locked) return message.reply('❌ Typowanie globalne jest zablokowane przez administratora!');
        
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        
        if (!matchId || !pred) {
            return message.reply('❌ Błędny format! Pamiętaj o **spacji**: `!typ [ID] [Wynik]` (np. `!typ 1 2-0`)');
        }
        
        const match = db.matches[matchId];
        if (!match) return message.reply('❌ Taki mecz nie istnieje! Sprawdź ID za pomocą `!mecze`.');
        if (match.locked) return message.reply(`❌ Typowanie dla meczu ID ${matchId} jest zamknięte.`);

        const userId = message.author.id;
        if (!db.users[userId]) db.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        
        db.users[userId].predictions[matchId] = pred;
        saveDB(db);
        return message.reply(`✅ <@${userId}>, zapisano typ: **${pred}** dla meczu ID **${matchId}**.`);
    }

    // --- GRACZ: PRYWATNY KANAŁ ---
    if (command === 'prywatnykanal') {
        const guild = message.guild;
        const member = message.member;

        try {
            const thread = await message.channel.threads.create({
                name: `typeta-${member.user.username}`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                reason: 'Prywatny wątek na typy gracza',
            });

            await thread.members.add(member.id);
            return message.reply(`🔒 Utworzono Twój prywatny wątek: <#${thread.id}>`);
        } catch (error) {
            console.error(error);
            return message.reply('❌ Nie udało się utworzyć prywatnego wątku (sprawdź uprawnienia bota).');
        }
    }

    // --- GRACZ: PROFIL ---
    if (command === 'profil' || command === 'statystyki') {
        const userId = message.author.id;
        const userData = db.users[userId] || { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };

        const points = userData.points || 0;
        const exactHits = userData.exactHits || 0;
        const winnerHits = userData.winnerHits || 0;
        const settledCount = userData.settledCount || 0;

        let winRate = settledCount > 0 ? Math.round(((exactHits + winnerHits) / settledCount) * 100) : 0;
        const sortedUsers = Object.entries(db.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
        const userRankIndex = sortedUsers.findIndex(([id]) => id === userId);
        const rankText = userRankIndex !== -1 ? `#${userRankIndex + 1}` : 'Poza rankingiem';

        const embed = new EmbedBuilder()
            .setTitle(`📊 Profil: ${message.author.username}`)
            .setColor(0x00FFCC)
            .addFields(
                { name: '🏆 Punkty', value: `**${points} pkt** (Miejsce: ${rankText})`, inline: true },
                { name: '🎯 Dokładny wynik (3 pkt)', value: `**${exactHits}**`, inline: true },
                { name: '✅ Trafiony zwycięzca (1 pkt)', value: `**${winnerHits}**`, inline: true },
                { name: '📈 Skuteczność', value: `**${winRate}%** (z ${settledCount})`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL());

        return message.reply({ embeds: [embed] });
    }

    // --- GRACZ: MOJE TYPY / HISTORIA ---
    if (command === 'mojetypy' || command === 'historia') {
        const userData = db.users[message.author.id];
        if (!userData || Object.keys(userData.predictions).length === 0) return message.reply('📌 Brak zapisanych typów.');
        let desc = '';
        for (const mId in userData.predictions) {
            const matchName = db.matches[mId] ? db.matches[mId].details : 'Mecz usunięty';
            desc += `• **[ID ${mId}]** ${matchName} ➔ \`${userData.predictions[mId]}\`\n`;
        }
        const embed = new EmbedBuilder().setTitle('📜 Twoje typy').setDescription(desc).setColor(0x9B59B6);
        return message.reply({ embeds: [embed], flags: 64 });
    }
});

client.login(TOKEN);
                                                              
