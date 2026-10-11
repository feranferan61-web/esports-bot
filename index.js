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

// --- 1. PANCERNA OBSŁUGA BAZY DANYCH ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

let memoryDB = {
    matches: {},
    users: {},
    bets: {},
    settings: { locked: false },
    nextMatchId: 1
};

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
            await pool.query('INSERT INTO kv_store (key, value) VALUES ($1, $2)', ['main_db', JSON.stringify(memoryDB)]);
        } else {
            const loaded = res.rows[0].value;
            memoryDB = {
                matches: loaded.matches || {},
                users: loaded.users || {},
                bets: loaded.bets || {},
                settings: loaded.settings || { locked: false },
                nextMatchId: loaded.nextMatchId || 1
            };
        }
        console.log('✅ Baza danych zainicjalizowana pomyślnie!');
    } catch (err) {
        console.error('❌ Błąd inicjalizacji bazy danych:', err);
    }
}

async function saveDB() {
    try {
        await pool.query(
            'INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
            ['main_db', JSON.stringify(memoryDB)]
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
        .addSubcommand(sub =>
            sub.setName('rozlicz')
                .setDescription('Rozlicz oficjalne wyniki meczu i przyznaj punkty')
                .addIntegerOption(opt => opt.setName('id').setDescription('ID Meczu').setRequired(true))
                .addStringOption(opt => opt.setName('wynik').setDescription('Dokładny wynik serii (np. 2:1)').setRequired(true))
                .addStringOption(opt => opt.setName('zwyciezca').setDescription('Nazwa wygranej drużyny').setRequired(true))
                .addStringOption(opt => opt.setName('mvp').setDescription('Oficjalny MVP meczu (Nick zawodnika)').setRequired(true))
                .addStringOption(opt => opt.setName('mapa1').setDescription('Oficjalny wynik Mapy 1 (np. 13:8)').setRequired(false))
                .addStringOption(opt => opt.setName('mapa2').setDescription('Oficjalny wynik Mapy 2 (np. 10:13)').setRequired(false))
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

// --- 5. OBSŁUGA ZDARZEŃ ---
client.once('ready', async () => {
    await initDB();
    console.log(`🤖 Zalogowano jako ${client.user.tag}! Bot gotowy do PGL Major Singapur 2026.`);
    await registerSlashCommands();
});

client.on('interactionCreate', async interaction => {
    try {
        // A. OBSŁUGA KOMEND SLASH
        if (interaction.isChatInputCommand()) {
            const { commandName, options } = interaction;

            if (commandName === 'mecze') {
                const matchKeys = Object.keys(memoryDB.matches);
                if (matchKeys.length === 0) {
                    return interaction.reply({ content: '📌 Brak aktywnych meczów w bazie. Administrator musi najpierw dodać mecz komendą `/admin dodaj_mecz`.', ephemeral: true });
                }

                let desc = 'Wybierz z poniższej listy mecz, który chcesz obstawić:\n\n';
                const selectOptions = [];

                for (const mId of matchKeys) {
                    const m = memoryDB.matches[mId];
                    if (!m || m.locked) continue;
                    
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

            if (commandName === 'profil') {
                const userId = interaction.user.id;
                const userData = memoryDB.users[userId] || { points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
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

            if (commandName === 'ranking') {
                const sorted = Object.entries(memoryDB.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
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

            if (commandName === 'admin') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: '❌ Brak uprawnień do komend administratora.', ephemeral: true });
                }

                const subcommand = options.getSubcommand();

                if (subcommand === 'dodaj_mecz') {
                    const teamA = options.getString('druzyna_a');
                    const teamB = options.getString('druzyna_b');
                    const format = options.getString('format');

                    const matchId = memoryDB.nextMatchId.toString();
                    memoryDB.nextMatchId++;

                    memoryDB.matches[matchId] = {
                        details: `${teamA} vs${teamB}`,
                        teamA,
                        teamB,
                        format,
                        locked: false
                    };

                    await saveDB();
                    return interaction.reply({ content: `✅ Dodano mecz ID **${matchId}**: **${teamA} vs ${teamB}** (${format})` });
                }

                if (subcommand === 'zablokuj') {
                    const matchId = options.getInteger('id').toString();
                    if (!memoryDB.matches[matchId]) {
                        return interaction.reply({ content: '❌ Nie znaleziono meczu o podanym ID.', ephemeral: true });
                    }

                    memoryDB.matches[matchId].locked = true;
                    await saveDB();
                    return interaction.reply({ content: `🔒 Zablokowano typowanie dla meczu ID **${matchId}**.` });
                }

                if (subcommand === 'rozlicz') {
                    const matchId = options.getInteger('id').toString();
                    const officialScore = options.getString('wynik').trim();
                    const officialWinner = options.getString('zwyciezca').trim().toLowerCase();
                    const officialMVP = options.getString('mvp').trim().toLowerCase();
                    const officialMap1 = (options.getString('mapa1') || '').trim();
                    const officialMap2 = (options.getString('mapa2') || '').trim();

                    const match = memoryDB.matches[matchId];
                    if (!match) {
                        return interaction.reply({ content: '❌ Nie znaleziono meczu o podanym ID.', ephemeral: true });
                    }

                    match.locked = true;
                    const matchBets = memoryDB.bets[matchId] || {};
                    let totalPlayers = 0;

                    for (const [uId, bet] of Object.entries(matchBets)) {
                        totalPlayers++;
                        if (!memoryDB.users[uId]) {
                            memoryDB.users[uId] = { points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
                        }

                        const u = memoryDB.users[uId];
                        u.settledCount++;

                        const userScore = (bet.score || '').trim();
                        const userMVP = (bet.mvp || '').trim().toLowerCase();
                        const userMap1 = (bet.map1 || '').trim();
                        const userMap2 = (bet.map2 || '').trim();

                        if (userScore === officialScore) {
                            u.points += 3;
                            u.exactHits++;
                        } else {
                            u.points += 1;
                            u.winnerHits++;
                        }

                        if (officialMap1 && userMap1 === officialMap1) {
                            u.points += 2;
                        }

                        if (officialMap2 && userMap2 === officialMap2) {
                            u.points += 2;
                        }

                        if (userMVP === officialMVP) {
                            u.points += 2;
                        }
                    }

                    await saveDB();

                    let mapDetails = '';
                    if (officialMap1) mapDetails += `\n🗺️ **Mapa 1 (${match.teamA}):** \`${officialMap1}\``;
                    if (officialMap2) mapDetails += `\n🗺️ **Mapa 2 (${match.teamB}):** \`${officialMap2}\``;

                    const embed = new EmbedBuilder()
                        .setTitle(`🎉 Rozliczono Mecz ID ${matchId}:${match.details}`)
                        .setColor(0x00FF00)
                        .setDescription(`Oficjalne wyniki i punkty zostały zaktualizowane!${mapDetails}`)
                        .addFields(
                            { name: '🎯 Wynik Serii', value: `\`${officialScore}\``, inline: true },
                            { name: '🏆 Zwycięzca', value: `\`${officialWinner.toUpperCase()}\``, inline: true },
                            { name: '⭐ MVP HLTV', value: `\`${officialMVP.toUpperCase()}\``, inline: true },
                            { name: '👥 Rozliczeni Gracze', value: `**${totalPlayers}**`, inline: false }
                        )
                        .setFooter({ text: 'Punkty zostały automatycznie zaktualizowane w klasyfikacji generalnej!' });

                    return interaction.reply({ embeds: [embed] });
                }
            }
        }

        // B. OBSŁUGA SELECT MENU
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_match_to_bet') {
                const selectedValue = interaction.values[0];
                const matchId = selectedValue.replace('typ_mecz_', '');
                const match = memoryDB.matches[matchId];

                if (!match || match.locked) {
                    return interaction.reply({ content: '❌ Ten mecz jest niedostępny lub został zablokowany.', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId(`modal_bet_${matchId}`)
                    .setTitle(`Typowanie: ${match.details} (${match.format})`);

                const scoreInput = new TextInputBuilder()
                    .setCustomId('score_input')
                    .setLabel(`Wynik meczu (np. ${match.format === 'BO1' ? '13:9' : '2:1'})`)
                    .setPlaceholder('Wpisz wynik ogólny')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const mvpInput = new TextInputBuilder()
                    .setCustomId('mvp_input')
                    .setLabel('Wybierz MVP HLTV (Nick gracza)')
                    .setPlaceholder('Wpisz nick zawodnika (np. ZywOo)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const components = [new ActionRowBuilder().addComponents(scoreInput)];

                if (match.format === 'BO3' || match.format === 'BO5') {
                    const map1Input = new TextInputBuilder()
                        .setCustomId('map1_input')
                        .setLabel(`Mapa 1 (Pick: ${match.teamA})`)
                        .setPlaceholder('np. 13:8')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false);

                    const map2Input = new TextInputBuilder()
                        .setCustomId('map2_input')
                        .setLabel(`Mapa 2 (Pick: ${match.teamB})`)
                        .setPlaceholder('np. 10:13')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false);

                    components.push(
                        new ActionRowBuilder().addComponents(map1Input),
                        new ActionRowBuilder().addComponents(map2Input)
                    );
                }

                components.push(new ActionRowBuilder().addComponents(mvpInput));
                modal.addComponents(components);

                return await interaction.showModal(modal);
            }
        }

        // C. OBSŁUGA FORMULARZY (MODAL)
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_bet_')) {
                const matchId = interaction.customId.replace('modal_bet_', '');
                const match = memoryDB.matches[matchId];
                const score = interaction.fields.getTextInputValue('score_input');
                const mvp = interaction.fields.getTextInputValue('mvp_input');
                
                let map1 = 'Brak';
                let map2 = 'Brak';

                try { map1 = interaction.fields.getTextInputValue('map1_input'); } catch (e) {}
                try { map2 = interaction.fields.getTextInputValue('map2_input'); } catch (e) {}

                const userId = interaction.user.id;

                if (!memoryDB.bets[matchId]) memoryDB.bets[matchId] = {};

                memoryDB.bets[matchId][userId] = {
                    score,
                    map1,
                    map2,
                    mvp,
                    timestamp: new Date().toISOString()
                };

                await saveDB();

                let replyMsg = `✅ Zapisano Twój typ na mecz **${match ? match.details : 'ID ' + matchId}**!\n🎯 **Wynik serii:** \`${score}\`\n⭐ **MVP:** \`${mvp}\``;
                if (map1 !== 'Brak') replyMsg += `\n🗺️ **Mapa 1 (${match.teamA}):** \`${map1}\``;
                if (map2 !== 'Brak') replyMsg += `\n🗺️ **Mapa 2 (${match.teamB}):** \`${map2}\``;

                return interaction.reply({ content: replyMsg, ephemeral: true });
            }
        }
    } catch (err) {
        console.error('❌ Błąd obsługi interakcji:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Wystąpił błąd podczas przetwarzania 
