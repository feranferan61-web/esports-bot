const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const { Client: PGClient } = require('pg');
const http = require('http');

// --- POŁĄCZENIE Z BAZĄ DANYCH SUPABASE ---
const db = new PGClient({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
    .then(() => console.log('Połączono z bazą danych Supabase!'))
    .catch(err => console.error('Błąd połączenia z bazą danych:', err));

async function initDB() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value JSONB
            )
        `);
        
        const res = await db.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
        if (res.rows.length === 0) {
            const initialData = { 
                matches: {}, 
                users: {}, 
                settings: { locked: false }, 
                nextMatchId: 1 
            };
            await db.query('INSERT INTO kv_store (key, value) VALUES ($1, $2)', ['main_db', JSON.stringify(initialData)]);
        }
        console.log('Struktura bazy danych gotowa.');
    } catch (err) {
        console.error('Błąd inicjalizacji bazy danych:', err);
    }
}

initDB();

async function loadDB() {
    try {
        const res = await db.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
        if (res.rows.length > 0) {
            let data = res.rows[0].value;
            if (!data.settings) data.settings = { locked: false };
            if (!data.nextMatchId) data.nextMatchId = 1;
            return data;
        }
    } catch (err) {
        console.error('Błąd ładowania bazy:', err);
    }
    return { matches: {}, users: {}, settings: { locked: false }, nextMatchId: 1 };
}

async function saveDB(data) {
    try {
        await db.query(
            'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
            ['main_db', JSON.stringify(data)]
        );
    } catch (err) {
        console.error('Błąd zapisu bazy:', err);
    }
}

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

function extractScore(text) {
    if (!text) return null;
    const match = text.toString().match(/\d+[-:]\d+/);
    return match ? match[0].replace(':', '-') : null;
}

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

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}! Bot gotowy.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    const database = await loadDB();

    // --- POMOC / KOMENDY ---
    if (command === 'komendy' || command === 'pomoc') {
        const embed = new EmbedBuilder()
            .setTitle('📖 Lista komend bota e-sportowego')
            .setColor(0x0099FF)
            .addFields(
                { 
                    name: '⚔ Komendy dla graczy', 
                    value: 
                        '`!mecze` - Lista aktywnych meczów\n' +
                        '`!typ [ID] [Wynik]` - Obstaw wynik (np. `!typ 1 2-1`)\n' +
                        '`!mojetypy` - Twoje typy\n' +
                        '`!profil` - Twój profil i statystyki\n' +
                        '`!historia` - Historia typów\n' +
                        '`!prywatnykanal` - Prywatny wątek'
                },
                { 
                    name: '🛡️ Komendy dla administratora', 
                    value: 
                        '`!dodajmecz [Nazwa]` - Dodaje mecz\n' +
                        '`!edytujmecz [ID] [Nowa nazwa]` - Zmienia nazwę\n' +
                        '`!usunmecz [ID]` - Usuwa mecz\n' +
                        '`!zablokujmecz [ID]` - Natychmiast blokuje typowanie meczu\n' +
                        '`!odblokujmecz [ID]` - Odblokowuje typowanie meczu\n' +
                        '`!zamknij` / `!otwórz` - Blokada globalna\n' +
                        '`!rozlicz [ID] [Wynik]` - Automatyczne rozliczenie meczu\n' +
                        '`!dodajpkt [@Gracz] [Punkty]` - Ręczne dodanie punktów\n' +
                        '`!usunpkt [@Gracz] [Punkty]` - Ręczne usunięcie punktów\n' +
                        '`!ranking` - Tabela wyników\n' +
                        '`!resetranking` - Reset bazy'
                }
            );
        return message.reply({ embeds: [embed] });
    }

    // --- ADMIN: DODAJ MECZ ---
    if (command === 'dodajmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchDetails = args.join(' ');
        if (!matchDetails) return message.reply('❌ Użycie: `!dodajmecz [Nazwa]`');
        
        const matchId = database.nextMatchId.toString();
        database.nextMatchId++;

        database.matches[matchId] = { details: matchDetails, locked: false };
        await saveDB(database);
        return message.reply(`✅ Dodano mecz z automatycznym ID: **${matchId}** (${matchDetails}).`);
    }

    if (command === 'edytujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const newDetails = args.slice(1).join(' ');
        if (!matchId || !newDetails || !database.matches[matchId]) return message.reply('❌ Użycie: `!edytujmecz [ID] [Nowa nazwa]`');

        database.matches[matchId].details = newDetails;
        await saveDB(database);
        return message.reply(`✏️ Zaktualizowano nazwę meczu ID **${matchId}** na: *${newDetails}*`);
    }

    if (command === 'usunmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !database.matches[matchId]) return message.reply('❌ Podaj poprawne ID istniejącego meczu!');

        delete database.matches[matchId];
        await saveDB(database);
        return message.reply(`🗑️ Usunięto mecz o ID: **${matchId}**`);
    }

    // --- ADMIN: BLOKADA KONKRETNEGO MECZU ---
    if (command === 'zablokujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !database.matches[matchId]) {
            return message.reply('❌ Użycie: `!zablokujmecz [ID]` (np. `!zablokujmecz 3`)');
        }

        database.matches[matchId].locked = true;
        await saveDB(database);
        return message.reply(`🔒 Mecz ID **${matchId}** został pomyślnie zablokowany. Gracze nie mogą już składać typów.`);
    }

    // --- ADMIN: ODBLOKOWANIE KONKRETNEGO MECZU ---
    if (command === 'odblokujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !database.matches[matchId]) {
            return message.reply('❌ Użycie: `!odblokujmecz [ID]` (np. `!odblokujmecz 3`)');
        }

        database.matches[matchId].locked = false;
        await saveDB(database);
        return message.reply(`🔓 Mecz ID **${matchId}** został odblokowany. Gracze mogą ponownie typować.`);
    }

    if (command === 'zamknij') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        database.settings.locked = true;
        await saveDB(database);
        return message.reply('🔒 Zablokowano typowanie globalnie dla wszystkich meczów.');
    }

    if (command === 'otwórz' || command === 'otworz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        database.settings.locked = false;
        await saveDB(database);
        return message.reply('🔓 Odblokowano typowanie globalnie.');
    }

    if (command === 'resetranking') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        database.users = {};
        database.matches = {};
        database.nextMatchId = 1;
        database.settings.locked = false;
        await saveDB(database);
        return message.reply('🔄 Zresetowano całą bazę danych i ranking.');
    }

    if (command === 'ranking' || command === 'punkty') {
        const sorted = Object.entries(database.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
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

    // --- ADMIN: RĘCZNE DODAWANIE PUNKTÓW ---
    if (command === 'dodajpkt') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        
        const targetUser = message.mentions.users.first();
        const pointsToAdd = parseInt(args[1], 10);

        if (!targetUser || isNaN(pointsToAdd)) {
            return message.reply('❌ Użycie: `!dodajpkt [@Gracz] [Liczba punktów]` (np. `!dodajpkt @Feran 3`)');
        }

        const userId = targetUser.id;
        if (!database.users[userId]) {
            database.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        }

        database.users[userId].points = (database.users[userId].points || 0) + pointsToAdd;
        await saveDB(database);

        return message.reply(`✅ Dodano **${pointsToAdd} pkt** dla gracza <@${userId}>. Aktualny stan: **${database.users[userId].points} pkt**.`);
    }

    // --- ADMIN: RĘCZNE USUWANIE PUNKTÓW ---
    if (command === 'usunpkt' || command === 'usuńpkt') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        
        const targetUser = message.mentions.users.first();
        const pointsToRemove = parseInt(args[1], 10);

        if (!targetUser || isNaN(pointsToRemove)) {
            return message.reply('❌ Użycie: `!usunpkt [@Gracz] [Liczba punktów]` (np. `!usunpkt @Feran 2`)');
        }

        const userId = targetUser.id;
        if (!database.users[userId]) {
            database.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        }

        database.users[userId].points = Math.max(0, (database.users[userId].points || 0) - pointsToRemove);
        await saveDB(database);

        return message.reply(`🗑️ Usunięto **${pointsToRemove} pkt** graczu <@${userId}>. Aktualny stan: **${database.users[userId].points} pkt**.`);
    }

    // --- ADMIN: ROZLICZ MECZ ---
    if (command === 'rozlicz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        
        const matchId = args[0];
        const rawInput = args.slice(1).join(' ');
        
        if (!matchId || !rawInput) return message.reply('❌ Użycie: `!rozlicz [ID] [Wynik]` (np. `!rozlicz 1 2-0`)');

        const officialScore = extractScore(rawInput);
        if (!officialScore) return message.reply('❌ Nie znaleziono poprawnego wyniku (np. `2-1`, `2-0`) w poleceniu!');

        const officialWinner = getWinnerFromScore(officialScore);
        let resultsSummary = `⚔️ **Rozliczenie meczu ID: ${matchId}**\n🏆 Oficjalny wynik: **${officialScore}**\n\n`;
        let count = 0;

        for (const userId in database.users) {
            const user = database.users[userId];
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

            if (playerScores && playerScores === officialScore) {
                user.points += 3;
                user.exactHits += 1;
                hitType = `🎯 Trafił **dokładny wynik** (${playerPred})! **+3 pkt**`;
            } else if (playerWinner && officialWinner && playerWinner === officialWinner) {
                user.points += 1;
                user.winnerHits += 1;
                hitType = `✅ Trafił **zwycięzcę** (${playerPred})! **+1 pkt**`;
            } else {
                hitType = `❌ Pomylił się (${playerPred}). 0 pkt`;
            }

            resultsSummary += `<@${userId}>: ${hitType}\n`;
        }

        await saveDB(database);
        if (count === 0) return message.reply(`⚠️ Żaden użytkownik nie obstawił meczu ID ${matchId}. Możesz dodać punkty ręcznie komendą \`!dodajpkt\`.`);
        return message.channel.send(resultsSummary);
    }

    // --- GRACZ: MECZE ---
    if (command === 'mecze') {
        const matchKeys = Object.keys(database.matches);
        if (matchKeys.length === 0) return message.reply('📌 Brak aktywnych meczów.');
        let desc = '';
        for (const mId of matchKeys) {
            const m = database.matches[mId];
            let lockInfo = m.locked ? ' (🔒 Zamknięty)' : ' (🟢 Otwarty)';
            desc += `• **ID ${mId}**: ${m.details}${lockInfo}\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Lista aktywnych meczów').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    // --- GRACZ: TYP ---
    if (command === 'typ') {
        if (database.settings.locked) return message.reply('❌ Typowanie globalne jest zablokowane!');
        
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        
        if (!matchId || !pred) {
            return message.reply('❌ Użycie: `!typ [ID] [Wynik]` (np. `!typ 1 2-0`)');
        }
        
        const match = database.matches[matchId];
        if (!match) return message.reply('❌ Taki mecz nie istnieje!');
        if (match.locked) return message.reply(`❌ Typowanie dla meczu ID ${matchId} jest zamknięte.`);

        const userId = message.author.id;
        if (!database.users[userId]) database.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        
        database.users[userId].predictions[matchId] = pred;
        await saveDB(database);
        return message.reply(`✅ <@${userId}>, zapisano typ: **${pred}** dla meczu ID **${matchId}**.`);
    }

    // --- GRACZ: PRYWATNY KANAŁ ---
    if (command === 'prywatnykanal') {
        try {
            const thread = await message.channel.threads.create({
                name: `typeta-${message.member.user.username}`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                reason: 'Prywatny wątek na typy gracza',
            });

            await thread.members.add(message.author.id);
            return message.reply(`🔒 Utworzono Twój prywatny wątek: <#${thread.id}>`);
        } catch (error) {
            console.error(error);
            return message.reply('❌ Nie udało się utworzyć prywatnego wątku.');
        }
    }

    // --- GRACZ: PROFIL ---
    if (command === 'profil' || command === 'statystyki') {
        const userId = message.author.id;
        const userData = database.users[userId] || { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };

        const points = userData.points || 0;
        const exactHits = userData.exactHits || 0;
        const winnerHits = userData.winnerHits || 0;
        const settledCount = userData.settledCount || 0;

        let winRate = settledCount > 0 ? Math.round(((exactHits + winnerHits) / settledCount) * 100) : 0;
        const sortedUsers = Object.entries(database.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
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
        const userData = database.users[message.author.id];
        if (!userData || Object.keys(userData.predictions).length === 0) return message.reply('📌 Brak zapisanych typów.');
        let desc = '';
        for (const mId in userData.predictions) {
            const matchName = database.matches[mId] ? database.matches[mId].details : 'Mecz usunięty';
            desc += `• **[ID ${mId}]** ${matchName} ➔ \`${userData.predictions[mId]}\`\n`;
        }
        const embed = new EmbedBuilder().setTitle('📜 Twoje typy').setDescription(desc).setColor(0x9B59B6);
        return message.reply({ embeds: [embed], flags: 64 });
    }
});

client.login(TOKEN);
            
