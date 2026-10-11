const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionsBitField 
} = require('discord.js');
const { Client: PGClient } = require('pg');
const http = require('http');

// --- 1. POŁĄCZENIE Z BAZĄ DANYCH SUPABASE ---
const db = new PGClient({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
    .then(() => console.log('✅ Połączono z bazą danych Supabase!'))
    .catch(err => console.error('❌ Błąd połączenia z bazą danych:', err));

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
        console.log('✅ Baza danych zainicjalizowana pomyślnie.');
    } catch (err) {
        console.error('❌ Błąd inicjalizacji bazy danych:', err);
    }
}
initDB();

async function loadDB() {
    try {
        const res = await db.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
        if (res.rows.length > 0) return res.rows[0].value;
    } catch (err) {
        console.error('❌ Błąd ładowania bazy:', err);
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
        console.error('❌ Błąd zapisu bazy:', err);
    }
}

// --- 2. SERWER HTTP (UPTIMEROBOT 24/7) ---
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot PGL Major Singapur 2026 dziala 24/7!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serwer HTTP na porcie ${PORT}`));

// --- 3. INICJALIZACJA BOTA DISCORD ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- 4. REJESTRACJA KOMEND SLASH ( / ) ---
const slashCommands = [
    new SlashCommandBuilder()
        .setName('mecze')
        .setDescription('📋 Lista aktywnych meczów PGL Major Singapur 2026'),

    new SlashCommandBuilder()
        .setName('profil')
        .setDescription('📊 Wyświetla Twój profil, statystyki i rangi'),

    new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('🏆 Tabela liderów turnieju'),

    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('🛡️ Panel zarządzenia turniejem (Admin)')
        .addSubcommand(sub =>
            sub.setName('dodaj_mecz')
                .setDescription('Dodaj nowy mecz')
                .addStringOption(opt => opt.setName('druzyna_a').setDescription('Pierwsza drużyna').setRequired(true))
                .addStringOption(opt => opt.setName('druzyna_b').setDescription('Druga drużyna').setRequired(true))
                .addStringOption(opt => opt.setName('format').setDescription('Format meczu').setRequired(true)
                    .addChoices(
                        { name: 'BO1', value: 'BO1' },
                        { name: 'BO3', value: 'BO3' },
                        { name: 'BO5 (Finał)', value: 'BO5' }
                    ))
        )
        .addSubcommand(sub =>
            sub.setName('zablokuj')
                .setDescription('Zablokuj typowanie meczu')
                .addIntegerOption(opt => opt.setName('id').setDescription('ID Meczu').setRequired(true))
        )
].map(cmd => cmd.toJSON());

async function registerSlashCommands() {
    try {
        if (!process.env.CLIENT_ID || !process.env.DISCORD_TOKEN) {
            console.error('⚠️ Brak CLIENT_ID lub DISCORD_TOKEN w zmiennych środowiskowych!');
            return;
        }
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        console.log('🔄 Rejestracja komend Slash w API Discorda...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: slashCommands }
        );
        console.log('✅ Rejestracja komend Slash zakończona sukcesem!');
    } catch (err) {
        console.error('❌ Błąd rejestracji komend Slash:', err);
    }
}

// --- 5. OBSŁUGA ZDARZEŃ (EVENTS) ---
client.once('ready', async () => {
    console.log(`🤖 Zalogowano jako ${client.user.tag}! Bot gotowy do PGL Major Singapur 2026.`);
    await registerSlashCommands();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;
    const database = await loadDB();

    // /mecze
    if (commandName === 'mecze') {
        const matchKeys = Object.keys(database.matches);
        if (matchKeys.length === 0) {
            return interaction.reply({ content: '📌 Brak aktywnych meczów w bazie.', ephemeral: true });
        }

        let desc = '';
        for (const mId of matchKeys) {
            const m = database.matches[mId];
            const status = m.locked ? '🔒 Zamknięty' : '🟢 Otwarty';
            desc += `• **ID ${mId}**: ${m.details} [${m.format || 'BO3'}] — ${status}\n`;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 PGL Major Singapur 2026 — Aktywne Mecze')
            .setDescription(desc)
            .setColor(0xFF6B00);

        return interaction.reply({ embeds: [embed] });
    }

    // /profil
    if (commandName === 'profil') {
        const userId = interaction.user.id;
        const userData = database.users[userId] || { points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
        const winRate = userData.settledCount > 0 ? Math.round(((userData.exactHits + userData.winnerHits) / userData.settledCount) * 100) : 0;

        const embed = new EmbedBuilder()
            .setTitle(`📊 Profil Gracza: ${interaction.user.username}`)
            .setColor(0x00FFCC)
            .addFields(
                { name: '🏆 Punkty', value: `**${userData.points || 0} pkt**`, inline: true },
                { name: '🎯 Dokładne Wyniki', value: `**${userData.exactHits || 0}**`, inline: true },
                { name: '✅ Trafieni Zwycięzcy', value: `**${userData.winnerHits || 0}**`, inline: true },
                { name: '📈 Skuteczność', value: `**${winRate}%**`, inline: true }
            )
            .setThumbnail(interaction.user.displayAvatarURL());

        return interaction.reply({ embeds: [embed] });
    }

    // /ranking
    if (commandName === 'ranking') {
        const sorted = Object.entries(database.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
        if (sorted.length === 0) {
            return interaction.reply({ content: '🏆 Tabela rankingowa jest pusta.', ephemeral: true });
        }

        let desc = '';
        sorted.forEach(([id, data], i) => {
            let medal = `${i + 1}.`;
            if (i === 0) medal = '🥇';
            if (i === 1) medal = '🥈';
            if (i === 2) medal = '🥉';
            desc += `${medal} <@${id}> — **${data.points || 0} pkt**\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle('🏆 PGL Major Singapur 2026 — Klasyfikacja Generalna')
            .setDescription(desc)
            .setColor(0xFFD700);

        return interaction.reply({ embeds: [embed] });
    }

    // /admin
    if (commandName === 'admin') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Brak uprawnień do komend administratora.', ephemeral: true });
        }

        const subcommand = options.getSubcommand();

        if (subcommand === 'dodaj_mecz') {
            const teamA = options.getString('druzyna_a');
            const teamB = options.getString('druzyna_b');
            const format = options.getString('format');

            const matchId = database.nextMatchId.toString();
            database.nextMatchId++;

            database.matches[matchId] = {
                details: `${teamA} vs ${teamB}`,
                teamA,
                teamB,
                format,
                locked: false
            };

            await saveDB(database);
            return interaction.reply({ content: `✅ Dodano mecz ID **${matchId}**: **${teamA} vs ${teamB}** (${format})` });
        }

        if (subcommand === 'zablokuj') {
            const matchId = options.getInteger('id').toString();
            if (!database.matches[matchId]) {
                return interaction.reply({ content: '❌ Nie znaleziono meczu o podanym ID.', ephemeral: true });
            }

            database.matches[matchId].locked = true;
            await saveDB(database);
            return interaction.reply({ content: `🔒 Zablokowano typowanie dla meczu ID **${matchId}**.` });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
            
