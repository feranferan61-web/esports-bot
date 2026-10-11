const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionsBitField 
} = require('discord.js');
const { Pool } = require('pg');
const http = require('http');

// --- 1. PANCERNA OBSŁUGA BAZY DANYCH (POOL) ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value JSONB
            )
        `);
        
        const res = await pool.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
        if (res.rows.length === 0) {
            const initialData = { 
                matches: {}, 
                users: {}, 
                settings: { locked: false }, 
                nextMatchId: 1 
            };
            await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2)', ['main_db', JSON.stringify(initialData)]);
        }
        console.log('✅ Baza danych zainicjalizowana pomyślnie!');
    } catch (err) {
        console.error('❌ Błąd inicjalizacji bazy danych:', err);
    }
}

async function loadDB() {
    try {
        const res = await pool.query('SELECT value FROM kv_store WHERE key = $1', ['main_db']);
        if (res.rows.length > 0) return res.rows[0].value;
    } catch (err) {
        console.error('❌ Błąd ładowania bazy:', err);
    }
    return { matches: {}, users: {}, settings: { locked: false }, nextMatchId: 1 };
}

async function saveDB(data) {
    try {
        await pool.query(
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
server.listen(PORT, () => console.log(`🚀 Serwer HTTP uruchomiony na porcie ${PORT}`));

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
        .setDescription('📋 Wyświetla listę meczów i pozwala wybrać mecz do typowania'),

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
    await initDB();
    console.log(`🤖 Zalogowano jako ${client.user.tag}! Bot gotowy do PGL Major Singapur 2026.`);
    await registerSlashCommands();
});

client.on('interactionCreate', async interaction => {
    try {
        const database = await loadDB();

        // A. OBSŁUGA KOMEND SLASH ( / )
        if (interaction.isChatInputCommand()) {
            const { commandName, options } = interaction;

            // /mecze - Wyświetla listę z menu rozwijanym
            if (commandName === 'mecze') {
                const matchKeys = Object.keys(database.matches);
                if (matchKeys.length === 0) {
                    return interaction.reply({ content: '📌 Brak aktywnych meczów w bazie. Administrator musi najpierw dodać mecz komendą `/admin dodaj_mecz`.', ephemeral: true });
                }

                let desc = 'Wybierz z poniższej listy mecz, który chcesz obstawić:\n\n';
                const selectOptions = [];

                for (const mId of matchKeys) {
                    const m = database.matches[mId];
                    if (m.locked) continue; // pomijamy zablokowane mecze
                    
                    desc += `• **ID ${mId}**: ${m.details} [${m.format}]\n`;
                    selectOptions.push({
                        label: `Mecz ${mId}:${m.details}`.substring(0, 100),
                        description: `Format: ${m.format} — Kliknij, aby wytypować`,
                        value: `typ_mecz_${mId}`
                    });
                }

                if (selectOptions.length === 0) {
                    return interaction.reply({ content: '🔒 Wszystkie aktywne mecze zostały obecnie zablokowane do typowania.', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle('🎮 PGL Major Singapur 2026 — Centrum Typowania')
                    .setDescription(desc)
                    .setColor(0xFF6B00);

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('select_match_to_bet')
                        .setPlaceholder('Wybierz mecz do obstawienia...')
                        .addOptions(selectOptions)
                );

                return interaction.reply({ embeds: [embed], components: [row] });
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
                        details: `${teamA} vs${teamB}`,
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
        }

        // B. OBSŁUGA WYBORU Z LISTY ROZWIJANEJ (SELECT MENU)
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_match_to_bet') {
                const selectedValue = interaction.values[0]; // np. "typ_mecz_1"
                const matchId = selectedValue.replace('typ_mecz_', '');
                const match = database.matches[matchId];

                if (!match || match.locked) {
                    return interaction.reply({ content: '❌ Ten mecz jest niedostępny lub został zablokowany.', ephemeral: true });
                }

                // Otwieramy okienko (Modal) z typowaniem
                const modal = new ModalBuilder()
                    .setCustomId(`modal_bet_${matchId}`)
                    .setTitle(`Typowanie: ${match.details} (${match.format})`);

                const scoreInput = new TextInputBuilder()
                    .setCustomId('score_input')
                    .setLabel('Wynik serii (np. 2:0 lub 2:1)')
                    .setPlaceholder('Wpisz np. 2:1')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const mvpInput = new TextInputBuilder()
                    .setCustomId('mvp_input')
                    .setLabel('Wybierz MVP HLTV (Nick gracza)')
                    .setPlaceholder('Wpisz nick zawodnika (np. ZywOo)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(scoreInput),
                    new ActionRowBuilder().addComponents(mvpInput)
                );

                return await interaction.showModal(modal);
            }
        }

        // C. OBSŁUGA WYSŁANEGO FORMULARZA (MODAL SUBMIT)
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_bet_')) {
                const matchId = interaction.customId.replace('modal_bet_', '');
                const score = interaction.fields.getTextInputValue('score_input');
                const mvp = interaction.fields.getTextInputValue('mvp_input');
                const userId = interaction.user.id;

                if (!database.bets) database.bets = {};
                if (!database.bets[matchId]) database.bets[matchId] = {};

                // Zapisujemy typ użytkownika
                database.bets[matchId][userId] = {
                    score,
                    mvp,
                    timestamp: new Date().toISOString()
                };

                await saveDB(database);

                return interaction.reply({ 
                    content: `✅ Zapisano Twój typ na mecz **ID ${matchId}**!\n🎯 **Wynik:** \`${score}\`\n⭐ **MVP:** \`${mvp}\``, 
                    ephemeral: true 
                });
            }
        }
    } catch (err) {
        console.error('❌ Błąd obsługi interakcji:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Wystąpił błąd podczas przetwarzania żądania.', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
                 
