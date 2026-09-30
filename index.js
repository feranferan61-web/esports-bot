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

    // --- POMOC ---
    if (command === 'komendy' || command === 'pomoc') {
        const embed = new EmbedBuilder()
            .setTitle('📖 Lista komend bota')
            .setColor(0x0099FF)
            .addFields(
                { 
                    name: '🎮 Gracze', 
                    value: 
                        '`!mecze` - Lista aktywnych meczów\n' +
                        '`!typ [ID] [Wynik]` - Obstaw wynik (np. `!typ 1 2-0`)\n' +
                        '`!mojetypy` - Twoje typy\n' +
                        '`!profil` - Statystyki i punkty\n' +
                        '`!historia` - Historia typów'
                },
                { 
                    name: '🛡️ Administrator', 
                    value: 
                        '`!dodajmecz [Nazwa]` - Dodaje mecz\n' +
                        '`!usunmecz [ID]` - Usuwa mecz\n' +
                        '`!rozlicz [ID] [Wynik]` - Rozlicza mecz (np. `!rozlicz 1 2-1`)\n' +
                        '`!ranking` - Tabela wyników\n' +
                        '`!resetranking` - Resetuje wszystko'
                }
            );
        return message.reply({ embeds: [embed] });
    }

    // --- ADMIN: DODAJ MECZ ---
    if (command === 'dodajmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchDetails = args.join(' ');
        if (!matchDetails) return message.reply('❌ Użycie: `!dodajmecz [Nazwa meczu]` (np. `!dodajmecz Faze vs zombies`)');
        
        const matchId = db.nextMatchId.toString();
        db.nextMatchId++;

        db.matches[matchId] = { details: matchDetails, locked: false, lockTime: null };
        saveDB(db);
        return message.reply(`✅ Dodano mecz z automatycznym **ID: ${matchId}** (${matchDetails}).`);
    }

    if (command === 'usunmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !db.matches[matchId]) return message.reply('❌ Podaj poprawne ID istniejącego meczu!');

        delete db.matches[matchId];
        saveDB(db);
        return message.reply(`🗑️ Usunięto mecz o ID: **${matchId}**`);
    }

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

    if (command === 'ranking' || command === 'punkty') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
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

    // --- ADMIN: ROZLICZ MECZ (POPRAWIONE) ---
    if (command === 'rozlicz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        
        const matchId = args[0];
        const rawInput = args.slice(1).join(' ');
        
        if (!matchId || !rawInput) return message.reply('❌ Użycie: `!rozlicz [ID] [Wynik]` (np. `!rozlicz 1 2-1`)');

        const officialScore = extractScore(rawInput);
        if (!officialScore) return message.reply('❌ Nie znaleziono poprawnego wyniku (np. `2-1`, `2-0`) w poleceniu rozliczenia!');

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
            // 2. Trafiony zwycięzca po wyniku (1 pkt) - np. typował 2-0, wynik to 2-1 (wygrała ta sama strona)
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
            desc += `• **ID ${mId}**: ${m.details}\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Lista aktywnych meczów').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    // --- GRACZ: TYP (Zabezpieczone przed sklejaniem ID z wynikiem) ---
    if (command === 'typ') {
        if (db.settings.locked) return message.reply('❌ Typowanie globalne zablokowane!');
        
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        
        if (!matchId || !pred) {
            return message.reply('❌ Błędny format! Pamiętaj o **spacjach**: `!typ [ID] [Wynik]` (np. `!typ 1 2-0`)');
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

    // --- GRACZ: PROFIL ---
    if (command === 'profil' || command === 'statystyki') {
        const userId = message.author.id;
        const userData = db.users[userId] || { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };

        const points = userData.points || 0;
        const exactHits = userData.exactHits || 0;
        const winnerHits = userData.winnerHits || 0;
        const settledCount = userData.settledCount || 0;
        const totalPreds = userData.predictions ? Object.keys(userData.predictions).length : 0;

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
            
