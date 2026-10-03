const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const { Client: PGClient } = require('pg');
const http = require('http');

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

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Discord dziala 24/7!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Mini serwer HTTP dziala na porcie ${PORT}`);
});

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

    if (command === 'komendy' || command === 'pomoc') {
        const embed = new EmbedBuilder()
            .setTitle('📖 Lista komend bota e-sportowego (AKTUALNA)')
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
                        '`!zablokujmecz [ID]` - Blokuje pojedynczy mecz\n' +
                        '`!odblokujmecz [ID]` - Odblokowuje pojedynczy mecz\n' +
                        '`!zamknij` / `!otwórz` - Blokada globalna\n' +
                        '`!rozlicz [ID] [Wynik]` - Rozlicza mecz\n' +
                        '`!dodajpkt [@Gracz] [Punkty]` - Dodaje punkty\n' +
                        '`!usunpkt [@Gracz] [Punkty]` - Usuwa punkty\n' +
                        '`!ranking` - Tabela wyników\n' +
                        '`!resetranking` - Reset bazy'
                }
            );
        return message.reply({ embeds: [embed] });
    }

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
        return message.reply(`🗑️️ Usunięto mecz o ID: **${matchId}**`);
    }

    if (command === 'zablokujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !database.matches[matchId]) return message.reply('❌ Użycie: `!zablokujmecz [ID]`');

        database.matches[matchId].locked = true;
        await saveDB(database);
        return message.reply(`🔒 Mecz ID **${matchId}** został zablokowany.`);
    }

    if (command === 'odblokujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !database.matches[matchId]) return message.reply('❌ Użycie: `!odblokujmecz [ID]`');

        database.matches[matchId].locked = false;
        await saveDB(database);
        return message.reply(`🔓 Mecz ID **${matchId}** został odblokowany.`);
    }

    if (command === 'zamknij') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        database.settings.locked = true;
        await saveDB(database);
        return message.reply('🔒 Zablokowano typowanie globalnie.');
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
        return message.reply('🔄 Zresetowano bazę.');
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

    if (command === 'dodajpkt') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const targetUser = message.mentions.users.first();
        const pointsToAdd = parseInt(args[1], 10);
        if (!targetUser || isNaN(pointsToAdd)) return message.reply('❌ Użycie: `!dodajpkt [@Gracz] [Punkty]`');

        const userId = targetUser.id;
        if (!database.users[userId]) database.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };

        database.users[userId].points = (database.users[userId].points || 0) + pointsToAdd;
        await saveDB(database);
        return message.reply(`✅ Dodano **${pointsToAdd} pkt** dla <@userId>.`);
    }

    if (command === 'usunpkt' || command === 'usuńpkt') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const targetUser = message.mentions.users.first();
        const pointsToRemove = parseInt(args[1], 10);
        if (!targetUser || isNaN(pointsToRemove)) return message.reply('❌ Użycie: `!usunpkt [@Gracz] [Punkty]`');

        const userId = targetUser.id;
        if (!database.users[userId]) database.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };

        database.users[userId].points = Math.max(0, (database.users[userId].points || 0) - pointsToRemove);
        await saveDB(database);
        return message.reply(`🗑️ Usunięto **${pointsToRemove} pkt** graczu <@${userId}>.`);
    }

    if (command === 'rozlicz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const rawInput = args.slice(1).join(' ');
        if (!matchId || !rawInput) return message.reply('❌ Użycie: `!rozlicz [ID] [Wynik]`');

        const officialScore = extractScore(rawInput);
        if (!officialScore) return message.reply('❌ Niepoprawny wynik!');

        const officialWinner = getWinnerFromScore(officialScore);
        let resultsSummary = `⚔️ **Rozliczenie ID: ${matchId}** | Wynik: **${officialScore}**\n\n`;
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

            if (playerScores && playerScores === officialScore) {
                user.points += 3;
                user.exactHits += 1;
                resultsSummary += `<@${userId}>: 🎯 Dokładny wynik (+3 pkt)\n`;
            } else if (playerWinner && officialWinner && playerWinner === officialWinner) {
                user.points += 1;
                user.winnerHits += 1;
                resultsSummary += `<@${userId}>: ✅ Zwycięzca (+1 pkt)\n`;
            } else {
                resultsSummary += `<@${userId}>: ❌ Pudło (0 pkt)\n`;
            }
        }

        await saveDB(database);
        if (count === 0) return message.reply('⚠️ Nikt nie obstawił tego meczu.');
        return message.channel.send(resultsSummary);
    }

    if (command === 'mecze') {
        const matchKeys = Object.keys(database.matches);
        if (matchKeys.length === 0) return message.reply('📌 Brak aktywnych meczów.');
        let desc = '';
        for (const mId of matchKeys) {
            const m = database.matches[mId];
            desc += `• **ID ${mId}**: ${m.details}${m.locked ? ' (🔒 Zamknięty)' : ' (🟢 Otwarty)'}\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Aktywne mecze').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    if (command === 'typ') {
        if (database.settings.locked) return message.reply('❌ Globalna blokada typowania!');
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        if (!matchId || !pred) return message.reply('❌ Użycie: `!typ [ID] [Wynik]`');
        
        const match = database.matches[matchId];
        if (!match) return message.reply('❌ Mecz nie istnieje!');
        if (match.locked) return message.reply('❌ Ten mecz jest zamknięty.');

        const userId = message.author.id;
        if (!database.users[userId]) database.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        
        database.users[userId].predictions[matchId] = pred;
        await saveDB(database);
        return message.reply(`✅ Zapisano typ **${pred**} dla meczu ID **${matchId}**.`);
    }

    if (command === 'prywatnykanal') {
        try {
            const thread = await message.channel.threads.create({
                name: `typeta-${message.member.user.username}`,
                autoArchiveDuration: 1440,
                type: ChannelType.PrivateThread,
                reason: 'Prywatny wątek',
            });
            await thread.members.add(message.author.id);
            return message.reply(`🔒 Utworzono wątek: <#${thread.id}>`);
        } catch (error) {
            return message.reply('❌ Nie udało się utworzyć wątku.');
        }
    }

    if (command === 'profil' || command === 'statystyki') {
        const userId = message.author.id;
        const userData = database.users[userId] || { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        const winRate = userData.settledCount > 0 ? Math.round(((userData.exactHits + userData.winnerHits) / userData.settledCount) * 100) : 0;
        
        const sortedUsers = Object.entries(database.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
        const userRankIndex = sortedUsers.findIndex(([id]) => id === userId);

        const embed = new EmbedBuilder()
            .setTitle(`📊 Profil: ${message.author.username}`)
            .setColor(0x00FFCC)
            .addFields(
                { name: '🏆 Punkty', value: `**${userData.points || 0} pkt** (Miejsce: #${userRankIndex !== -1 ? userRankIndex + 1 : '-'})`, inline: true },
                { name: '🎯 Dokładne', value: `**${userData.exactHits || 0}**`, inline: true },
                { name: '✅ Zwycięzcy', value: `**${userData.winnerHits || 0}**`, inline: true },
                { name: '📈 Skuteczność', value: `**${winRate}%**`, inline: true }
            );
        return message.reply({ embeds: [embed] });
    }

    if (command === 'mojetypy' || command === 'historia') {
        const userData = database.users[message.author.id];
        if (!userData || Object.keys(userData.predictions).length === 0) return message.reply('📌 Brak typów.');
        let desc = '';
        for (const mId in userData.predictions) {
            const matchName = database.matches[mId] ? database.matches[mId].details : 'Usunięty mecz';
            desc += `• **[ID ${mId}]** ${matchName} ➔ \`${userData.predictions[mId]}\`\n`;
        }
        const embed = new EmbedBuilder().setTitle('📜 Twoje typy').setDescription(desc).setColor(0x9B59B6);
        return message.reply({ embeds: [embed], flags: 64 });
    }
});

client.login(TOKEN);
        
