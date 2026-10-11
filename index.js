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
        await pool.query(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value JSONB)`);
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

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot PGL Major Singapur 2026 dziala 24/7!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serwer HTTP uruchomiony na porcie ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const slashCommands = [
    new SlashCommandBuilder().setName('mecze').setDescription('Wyświetla listę meczów do typowania'),
    new SlashCommandBuilder().setName('moje_typy').setDescription('🎯 Wyświetla Twoje obstawione mecze i typy'),
    new SlashCommandBuilder().setName('profil').setDescription('Twój profil i statystyki'),
    new SlashCommandBuilder().setName('ranking').setDescription('Tabela liderów turnieju'),
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Panel administracyjny')
        .addSubcommand(sub =>
            sub.setName('dodaj_mecz')
                .setDescription('Dodaj nowy mecz')
                .addStringOption(opt => opt.setName('druzyna_a').setDescription('Drużyna A').setRequired(true))
                .addStringOption(opt => opt.setName('druzyna_b').setDescription('Drużyna B').setRequired(true))
                .addStringOption(opt => opt.setName('format').setDescription('Format').setRequired(true)
                    .addChoices(
                        { name: 'BO1', value: 'BO1' },
                        { name: 'BO3', value: 'BO3' },
                        { name: 'BO5', value: 'BO5' }
                    ))
        )
        .addSubcommand(sub =>
            sub.setName('zablokuj')
                .setDescription('Zablokuj mecz')
                .addIntegerOption(opt => opt.setName('id').setDescription('ID Meczu').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('rozlicz')
                .setDescription('Rozlicz oficjalne wyniki meczu i przyznaj punkty')
                .addIntegerOption(opt => opt.setName('id').setDescription('ID Meczu').setRequired(true))
                .addStringOption(opt => opt.setName('wynik').setDescription('Wynik (np. 2:1)').setRequired(true))
                .addStringOption(opt => opt.setName('zwyciezca').setDescription('Zwycięzca').setRequired(true))
                .addStringOption(opt => opt.setName('mvp').setDescription('MVP (Nick)').setRequired(true))
                .addStringOption(opt => opt.setName('mapa1').setDescription('Wynik Mapy 1').setRequired(false))
                .addStringOption(opt => opt.setName('mapa2').setDescription('Wynik Mapy 2').setRequired(false))
        )
].map(cmd => cmd.toJSON());

async function registerSlashCommands() {
    try {
        if (!process.env.CLIENT_ID || !process.env.DISCORD_TOKEN) return;
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
        console.log('✅ Komendy zarejestrowane!');
    } catch (err) {
        console.error('❌ Błąd rejestracji komend:', err);
    }
}

client.once('ready', async () => {
    await initDB();
    console.log(`🤖 Zalogowano jako ${client.user.tag}!`);
    await registerSlashCommands();
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName, options } = interaction;

            if (commandName === 'mecze') {
                const matchKeys = Object.keys(memoryDB.matches);
                if (matchKeys.length === 0) {
                    return interaction.reply({ content: '📌 Brak aktywnych meczów w bazie.', ephemeral: true });
                }

                let desc = 'Wybierz mecz do obstawienia:\n\n';
                const selectOptions = [];

                for (const mId of matchKeys) {
                    const m = memoryDB.matches[mId];
                    if (!m || m.locked) continue;
                    desc += `• **ID ${mId}**: ${m.details} [${m.format}]\n`;
                    selectOptions.push({
                        label: `Mecz ${mId}:${m.details}`.substring(0, 100),
                        description: `Format: ${m.format}`,
                        value: `typ_mecz_${mId}`
                    });
                }

                if (selectOptions.length === 0) {
                    return interaction.reply({ content: '🔒 Wszystkie mecze są zablokowane.', ephemeral: true });
                }

                const embed = new EmbedBuilder().setTitle('🎮 Centrum Typowania').setDescription(desc).setColor(0xFF6B00);
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_match_to_bet').setPlaceholder('Wybierz mecz...').addOptions(selectOptions)
                );

                return interaction.reply({ embeds: [embed], components: [row] });
            }

            if (commandName === 'moje_typy') {
                const userId = interaction.user.id;
                const userBets = [];

                for (const [mId, bets] of Object.entries(memoryDB.bets || {})) {
                    if (bets[userId]) {
                        const m = memoryDB.matches[mId] || { details: `Mecz ID ${mId}`, teamA: 'Drużyna A', teamB: 'Drużyna B' };
                        const userBet = bets[userId];
                        let details = `• **${m.details}** (ID${mId}):\n  🎯 Wynik: \`${userBet.score}\` | ⭐ MVP: \`${userBet.mvp}\``;
                        
                        if (userBet.map1 && userBet.map1 !== 'Brak') details += `\n  🗺️ Mapa 1 (${m.teamA}): \`${userBet.map1}\``;
                        if (userBet.map2 && userBet.map2 !== 'Brak') details += `\n  🗺️ Mapa 2 (${m.teamB}): \`${userBet.map2}\``;
                        
                        userBets.push(details);
                    }
                }

                if (userBets.length === 0) {
                    return interaction.reply({ content: '❓ Nie obstawiłeś jeszcze żadnego meczu. Użyj `/mecze`, aby wytypować wyniki!', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle(`🎯 Twoje Wytypowane Mecze — ${interaction.user.username}`)
                    .setDescription(userBets.join('\n\n'))
                    .setColor(0x00FFCC);

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (commandName === 'profil') {
                const userId = interaction.user.id;
                const u = memoryDB.users[userId] || { points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
                const winRate = u.settledCount > 0 ? Math.round(((u.exactHits + u.winnerHits) / u.settledCount) * 100) : 0;

                const embed = new EmbedBuilder()
                    .setTitle(`📊 Profil: ${interaction.user.username}`)
                    .setColor(0x00FFCC)
                    .addFields(
                        { name: '🏆 Punkty', value: `**${u.points} pkt**`, inline: true },
                        { name: '🎯 Dokładne Wyniki', value: `**${u.exactHits}**`, inline: true },
                        { name: '✅ Trafieni Zwycięzcy', value: `**${u.winnerHits}**`, inline: true },
                        { name: '📈 Skuteczność', value: `**${winRate}%**`, inline: true }
                    );

                return interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'ranking') {
                const sorted = Object.entries(memoryDB.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
                if (sorted.length === 0) return interaction.reply({ content: '🏆 Ranking jest pusty.', ephemeral: true });

                let desc = '';
                sorted.forEach(([id, data], i) => {
                    let medal = `${i + 1}.`;
                    if (i === 0) medal = '🥇'; else if (i === 1) medal = '🥈'; else if (i === 2) medal = '🥉';
                    desc += `${medal} <@${id}> — **${data.points || 0} pkt**\n`;
                });

                const embed = new EmbedBuilder().setTitle('🏆 Klasyfikacja Generalna').setDescription(desc).setColor(0xFFD700);
                return interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'admin') {
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
                }

                const subcommand = options.getSubcommand();

                if (subcommand === 'dodaj_mecz') {
                    const teamA = options.getString('druzyna_a');
                    const teamB = options.getString('druzyna_b');
                    const format = options.getString('format');

                    const matchId = memoryDB.nextMatchId.toString();
                    memoryDB.nextMatchId++;
                    memoryDB.matches[matchId] = { details: `${teamA} vs ${teamB}`, teamA, teamB, format, locked: false };

                    await saveDB();
                    return interaction.reply({ content: `✅ Dodano mecz ID **${matchId}**: **${teamA} vs ${teamB}** (${format})` });
                }

                if (subcommand === 'zablokuj') {
                    const matchId = options.getInteger('id').toString();
                    if (!memoryDB.matches[matchId]) return interaction.reply({ content: '❌ Nie znaleziono meczu.', ephemeral: true });
                    memoryDB.matches[matchId].locked = true;
                    await saveDB();
                    return interaction.reply({ content: `🔒 Zablokowano mecz ID **${matchId}**.` });
                }

                if (subcommand === 'rozlicz') {
                    const matchId = options.getInteger('id').toString();
                    const officialScore = options.getString('wynik').trim();
                    const officialWinner = options.getString('zwyciezca').trim().toLowerCase();
                    const officialMVP = options.getString('mvp').trim().toLowerCase();
                    const officialMap1 = (options.getString('mapa1') || '').trim();
                    const officialMap2 = (options.getString('mapa2') || '').trim();

                    const match = memoryDB.matches[matchId];
                    if (!match) return interaction.reply({ content: '❌ Nie znaleziono meczu.', ephemeral: true });

                    match.locked = true;
                    const matchBets = memoryDB.bets[matchId] || {};
                    let totalPlayers = 0;

                    for (const [uId, bet] of Object.entries(matchBets)) {
                        totalPlayers++;
                        if (!memoryDB.users[uId]) memoryDB.users[uId] = { points: 0, exactHits: 0, winnerHits: 0, settledCount: 0 };
                        const u = memoryDB.users[uId];
                        u.settledCount++;

                        if ((bet.score || '').trim() === officialScore) {
                            u.points += 3;
                            u.exactHits++;
                        } else {
                            u.points += 1;
                            u.winnerHits++;
                        }

                        if (officialMap1 && (bet.map1 || '').trim() === officialMap1) u.points += 2;
                        if (officialMap2 && (bet.map2 || '').trim() === officialMap2) u.points += 2;
                        if ((bet.mvp || '').trim().toLowerCase() === officialMVP) u.points += 2;
                    }

                    await saveDB();
                    return interaction.reply({ content: `🎉 Rozliczono mecz ID ${matchId}! Przeliczono typy dla ${totalPlayers} graczy.` });
                }
            }
        }

        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_match_to_bet') {
                const matchId = interaction.values[0].replace('typ_mecz_', '');
                const match = memoryDB.matches[matchId];
                if (!match || match.locked) return interaction.reply({ content: '❌ Mecz niedostępny.', ephemeral: true });

                const modal = new ModalBuilder().setCustomId(`modal_bet_${matchId}`).setTitle(`Typowanie: ${match.details}`);

                const scoreInput = new TextInputBuilder()
                    .setCustomId('score_input')
                    .setLabel(`Wynik serii (np. 2:1)`)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const mvpInput = new TextInputBuilder()
                    .setCustomId('mvp_input')
                    .setLabel('MVP HLTV (Nick)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const components = [new ActionRowBuilder().addComponents(scoreInput)];

                if (match.format === 'BO3' || match.format === 'BO5') {
                    const map1Input = new TextInputBuilder().setCustomId('map1_input').setLabel(`Mapa 1 (Pick: ${match.teamA})`).setStyle(TextInputStyle.Short).setRequired(false);
                    const map2Input = new TextInputBuilder().setCustomId('map2_input').setLabel(`Mapa 2 (Pick: ${match.teamB})`).setStyle(TextInputStyle.Short).setRequired(false);
                    components.push(new ActionRowBuilder().addComponents(map1Input), new ActionRowBuilder().addComponents(map2Input));
                }

                components.push(new ActionRowBuilder().addComponents(mvpInput));
                modal.addComponents(components);

                return await interaction.showModal(modal);
            }
        }

        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_bet_')) {
                const matchId = interaction.customId.replace('modal_bet_', '');
                const match = memoryDB.matches[matchId];
                const score = interaction.fields.getTextInputValue('score_input');
                const mvp = interaction.fields.getTextInputValue('mvp_input');
                
                let map1 = 'Brak', map2 = 'Brak';
                try { map1 = interaction.fields.getTextInputValue('map1_input'); } catch (e) {}
                try { map2 = interaction.fields.getTextInputValue('map2_input'); } catch (e) {}

                if (!memoryDB.bets[matchId]) memoryDB.bets[matchId] = {};
                memoryDB.bets[matchId][interaction.user.id] = { score, map1, map2, mvp, timestamp: new Date().toISOString() };

                await saveDB();
                return interaction.reply({ content: `✅ Zapisano Twój typ na mecz **ID ${matchId}**!`, ephemeral: true });
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
                                                    
