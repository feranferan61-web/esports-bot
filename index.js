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

// Inicjalizacja tabel w bazie danych, jeśli jeszcze nie istnieją
async function initDB() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value JSONB
            )
        `);
        
        // Sprawdzamy, czy struktura danych już istnieje w tabeli, jeśli nie - tworzymy domyślną
        const res = await db.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
        if (res.rows.length === 0) {
            const initialData = { 
                matches: {}, 
                users: {}, 
                settings: { locked: false, lockTime: null }, 
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

// Funkcje pomocnicze do wczytywania i zapisu danych (zamiennik fs dla bazy SQL)
async function loadDB() {
    try {
        const res = await db.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
        if (res.rows.length > 0) {
            let data = res.rows[0].value;
            if (!data.settings) data.settings = { locked: false, lockTime: null };
            if (!data.nextMatchId) data.nextMatchId = 1;
            return data;
        }
    } catch (err) {
        console.error('Błąd ładowania bazy:', err);
    }
    return { matches: {}, users: {}, settings: { locked: false, lockTime: null }, nextMatchId: 1 };
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

// Sprawdzanie zamknięć co 5 sekund
setInterval(async () => {
    const db = await loadDB();
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

    if (modified) await saveDB(db);
}, 5000);

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}! Bot gotowy.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const db = await loadDB();

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
                        '`!zamknij` / `!otwórz` - Blokada globalna\n' +
                        '`!zamknijmecz [ID] [HH:MM]` - Automatyczne zamknięcie meczu (np. `!zamknijmecz 1 18:00`)\n' +
                        '`!rozlicz [ID] [Wynik]` - Automatyczne rozliczenie meczu\n' +
                        '`!dodajpkt [@Gracz] [Punkty]` - Ręczne dodanie punktów\n' +
                        '`!usunpkt [@Gracz] [Punkty]` - Ręczne usunięcie punktów (np. `!usunpkt @Feran 2`)\n' +
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
        
        const matchId = db.nextMatchId.toString();
        db.nextMatchId++;

        db.matches[matchId] = { details: matchDetails, locked: false, lockTime: null };
        await saveDB(db);
        return message.reply(`✅ Dodano mecz z automatycznym ID: **${matchId}** (${matchDetails}).`);
    }

    if (command === 'edytujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const newDetails = args.slice(1).join(' ');
        if (!matchId || !newDetails || !db.matches[matchId]) return message.reply('❌ Użycie: `!edytujmecz [ID] [Nowa nazwa]`');

        db.matches[matchId].details = newDetails;
        await saveDB(db);
        return message.reply(`✏️ Zaktualizowano nazwę meczu ID **${matchId}** na: *${newDetails}*`);
    }

    if (command === 'usunmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId || !db.matches[matchId]) return message.reply('❌ Podaj poprawne ID istniejącego meczu!');

        delete db.matches[matchId];
        await saveDB(db);
        return message.reply(`🗑️ Usunięto mecz o ID: **${matchId}**`);
    }

    if (command === 'zamknij') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = true;
        await saveDB(db);
        return message.reply('🔒 Zablokowano typowanie globalnie dla wszystkich meczów.');
    }

    if (command === 'otwórz' || command === 'otworz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = false;
        await saveDB(db);
        return message.reply('🔓 Odblokowano typowanie globalnie.');
    }

    // --- ADMIN: ZAMKNIJ MECZ ---
    if (command === 'zamknijmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        
        const matchId = args[0];
        const timeStr = args[1];

        if (!matchId || !timeStr || !db.matches[matchId]) {
            return message.reply('❌ Użycie: `!zamknijmecz [ID] [HH:MM]` (np. `!zamknijmecz 1 18:00`)');
        }

        const [hours, minutes] = timeStr.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) {
            return message.reply('❌ Błędny format godziny! Użyj formatu 24h, np. `!zamknijmecz 1 18:00`.');
        }

        const now = new Date();
        const targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);

        if (targetTime <= now) {
            if (now.getTime() - targetTime.getTime() <= 10 * 60 * 1000) {
                db.matches[matchId].locked = true;
                db.matches[matchId].lockTime = null;
                await saveDB(db);
                return message.reply(`🔒 Mecz ID **${matchId}** został natychmiast zamknięty (czas ${timeStr} minął).`);
            } else {
                targetTime.setDate(targetTime.getDate() + 1);
            }
        }

        db.matches[matchId].lockTime = targetTime.toISOString();
        db.matches[matchId].locked = false;
        await saveDB(db);
        return message.reply(`⏳ Mecz ID **${matchId}** automatycznie zamknie się o godzinie **${timeStr}**.`);
    }

    if (command === 'resetranking') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.users = {};
        db.matches = {};
        db.nextMatchId = 1;
        db.settings.locked = false;
        db.settings.lockTime = null;
        await saveDB(db);
        return message.reply('🔄 Zresetowano całą bazę danych i ranking.');
    }

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

    // --- ADMIN: RĘCZNE DODAWANIE PUNKTÓW ---
    if (command === 'dodajpkt') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        
        const targetUser = message.mentions.users.first();
        const pointsToAdd = parseInt(args[1], 10);

        if (!targetUser || isNaN(pointsToAdd)) {
            return message.reply('❌ Użycie: `!dodajpkt [@Gracz] [Liczba punktów]` (np. `!dodajpkt @Feran 3`)');
        }

        const userId = targetUser.id;
        if (!db.users[userId]) {
            db.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        }

        db.users[userId].points = (db.users[userId].points || 0) + pointsToAdd;
        await saveDB(db);

        return message.reply(`✅ Dodano **${pointsToAdd} pkt** dla gracza <@${userId}>. Aktualny stan: **${db.users[userId].points} pkt**.`);
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
        if (!db.users[userId]) {
            db.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        }

        db.users[userId].points = Math.max(0, (db.users[userId].points || 0) - pointsToRemove);
        await saveDB(db);

        return message.reply(`🗑️ Usunięto **${pointsToRemove} pkt** graczu <@${userId}>. Aktualny stan: **${db.users[userId].points} pkt**.`);
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

        await saveDB(db);
        if (count === 0) return message.reply(`⚠️ Żaden użytkownik nie obstawił meczu ID ${matchId}. Możesz dodać punkty ręcznie komendą \`!dodajpkt\`.`);
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
                const timeOnly = new Date(m.lockTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                lockInfo = ` (⏳ do ${timeOnly})`;
            }
            desc += `• **ID ${mId}**: ${m.details}${lockInfo}\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Lista aktywnych meczów').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    // --- GRACZ: TYP ---
    if (command === 'typ') {
        if (db.settings.locked) return message.reply('❌ Typowanie globalne jest zablokowane!');
        
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        
        if (!matchId || !pred) {
            return message.reply('❌ Użycie: `!typ [ID] [Wynik]` (np. `!typ 1 2-0`)');
        }
        
        const match = db.matches[matchId];
        if (!match) return message.reply('❌ Taki mecz nie istnieje!');
        if (match.locked) return message.reply(`❌ Typowanie dla meczu ID ${matchId} jest zamknięte.`);

        const userId = message.author.id;
        if (!db.users[userId]) db.users[userId] = { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        
        db.users[userId].predictions[matchId] = pred;
        await saveDB(db);
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
        const userData = db.users[userId] || { predictions: {}, points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };

        const points = userData.points || 0;
        const exactHits = userData.exactHits || 0;
        const winnerHits = userData.winnerHits || 0;
        const settledCount = userData.settledCount || 0;

        let winRate = settledCount > 0 ? Math.round(((exactHits + winnerHits) / settledCount) * 100) : 0;
        const sortedUsers = Object.entries(db.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0));
        const userRankIndex = sortedUsers.findIndex(([id]) => id === userId);
        const rankText = u
