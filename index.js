const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
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
  pickems: {
    stages: {},
    userPicks: {},
    mvpPicks: {}
  },
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
        pickems: {
          stages: loaded.pickems?.stages || {},
          userPicks: loaded.pickems?.userPicks || {},
          mvpPicks: loaded.pickems?.mvpPicks || {}
        },
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
server.listen(PORT, () => {
  console.log(`🌐 Serwer HTTP uruchomiony na porcie ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const slashCommands = [
  new SlashCommandBuilder().setName('mecze').setDescription('Wyświetla listę meczów do typowania'),
  new SlashCommandBuilder().setName('moje_typy').setDescription('Wyświetla Twoje typy na mecze'),
  new SlashCommandBuilder().setName('profil').setDescription('Twój profil'),
  new SlashCommandBuilder().setName('ranking').setDescription('Ranking'),
  new SlashCommandBuilder()
    .setName('pickem')
    .setDescription('Wybierz swoje typy Pick\'Em na dany stage')
    .addStringOption(opt => opt.setName('stage').setDescription('Wybierz stage').setRequired(true)
      .addChoices(
        { name: 'Stage 1 (Opening)', value: 'stage1' },
        { name: 'Stage 2 (Elimination)', value: 'stage2' },
        { name: 'Stage 3 (Playoffs)', value: 'stage3' }
      )),
  new SlashCommandBuilder().setName('moje_pickemy').setDescription('Wyświetla Twoje zapisane Pick\'Emy i MVP'),
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Panel administracyjny')
    .addSubcommand(sub =>
      sub.setName('dodaj_mecz')
        .setDescription('Dodaj mecz')
        .addStringOption(opt => opt.setName('druzyna_a').setDescription('A').setRequired(true))
        .addStringOption(opt => opt.setName('druzyna_b').setDescription('B').setRequired(true))
        .addStringOption(opt => opt.setName('format').setDescription('Format').setRequired(true).addChoices({ name: 'BO1', value: 'BO1' }, { name: 'BO3', value: 'BO3' }))
        .addStringOption(opt => opt.setName('data_blokady').setDescription('DD-MM-YYYY HH:mm').setRequired(false))
    )
    .addSubcommand(sub => sub.setName('zablokuj').setDescription('Zablokuj mecz').addIntegerOption(opt => opt.setName('id').setDescription('ID').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('rozlicz_mecz')
        .setDescription('Rozlicz wynik meczu')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu').setRequired(true))
        .addStringOption(opt => opt.setName('zwyciezca').setDescription('Nazwa wygranej drużyny').setRequired(true))
        .addStringOption(opt => opt.setName('wynik').setDescription('Dokładny wynik (np. 13-8 lub 2-1)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_setup')
        .setDescription('Konfiguruj drużyny dla stage\'u Pick\'Em')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices({ name: 'Stage 1', value: 'stage1' }, { name: 'Stage 2', value: 'stage2' }, { name: 'Stage 3', value: 'stage3' }))
        .addStringOption(opt => opt.setName('druzyny').setDescription('Lista drużyn oddzielona przecinkami').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_lock')
        .setDescription('Zablokuj/odblokuj Pick\'Em dla stage\'u')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices({ name: 'Stage 1', value: 'stage1' }, { name: 'Stage 2', value: 'stage2' }, { name: 'Stage 3', value: 'stage3' }))
        .addBooleanOption(opt => opt.setName('status').setDescription('True = zablokuj, False = odblokuj').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_rozlicz')
        .setDescription('Rozlicz punkty Pick\'Em dla danego stage\'u')
        .addStringOption(opt => opt.setName('stage').setDescription('Stage').setRequired(true)
          .addChoices({ name: 'Stage 1', value: 'stage1' }, { name: 'Stage 2', value: 'stage2' }, { name: 'Stage 3', value: 'stage3' }))
        .addStringOption(opt => opt.setName('oficjalne_30').setDescription('Oficjalne 3-0 (po przecinku)').setRequired(true))
        .addStringOption(opt => opt.setName('oficjalne_03').setDescription('Oficjalne 0-3 (po przecinku)').setRequired(true))
        .addStringOption(opt => opt.setName('oficjalne_adv').setDescription('Oficjalnie awansujące (po przecinku)').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('pickem_rozlicz_mvp')
        .setDescription('Rozlicz punkty za wytypowanie MVP (3 pkt)')
        .addStringOption(opt => opt.setName('gracz_mvp').setDescription('Nick oficjalnego MVP Turnieju').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reset_ranking')
        .setDescription('⚠️ Resetuje punkty i statystyki WSZYSTKICH graczy do zera')
    )
].map(cmd => cmd.toJSON());

function getWarsawDate() {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Warsaw" });
  return new Date(nowStr);
}

function parseCustomDate(dateStr) {
  if (!dateStr) return null;
  try {
    const [datePart, timePart] = dateStr.trim().split(' ');
    const [day, month, year] = datePart.split('-');
    const [hour, minute] = timePart.split(':');
    return new Date(year, month - 1, day, hour, minute);
  } catch (e) { return null; }
}

async function checkAndLockMatches() {
  const now = getWarsawDate();
  let changed = false;
  for (const [mId, m] of Object.entries(memoryDB.matches)) {
    if (!m.locked && m.lockDate && now >= new Date(m.lockDate)) {
      m.locked = true;
      changed = true;
    }
  }
  if (changed) await saveDB();
}

client.once('ready', async () => {
  await initDB();
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: slashCommands });
    console.log('✅ Zarejestrowano komendy Slash w Discordzie!');
  } catch (err) {
    console.error('❌ Błąd podczas rejestracji komend Slash:', err);
  }
  setInterval(checkAndLockMatches, 30000);
  console.log(`✅ Bot ${client.user.tag} jest gotowy do działania!`);
});

client.on('interactionCreate', async interaction => {
  try {
    await checkAndLockMatches();

    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;

      if (commandName === 'mecze') {
        const matchKeys = Object.keys(memoryDB.matches);
        const selectOptions = [];
        for (const mId of matchKeys) {
          const m = memoryDB.matches[mId];
          if (!m || m.locked) continue;
          selectOptions.push({ label: `Mecz ID ${mId}: ${m.details}`, value: `typ_mecz_${mId}` });
        }
        if (selectOptions.length === 0) return interaction.reply({ content: 'Brak dostępnych meczów do typowania.', ephemeral: true });
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_match_to_bet').setPlaceholder('Wybierz mecz...').addOptions(selectOptions));
        return interaction.reply({ content: 'Wybierz mecz z listy:', components: [row], ephemeral: true });
      }

      if (commandName === 'moje_typy') {
        const userId = interaction.user.id;
        const userBets = memoryDB.bets[userId];

        if (!userBets || Object.keys(userBets).length === 0) {
          return interaction.reply({ content: '📋 Nie obstawiłeś jeszcze żadnego meczu.', ephemeral: true });
        }

        let desc = '### 🎯 Twoje typy na mecze:\n';
        for (const [mId, betData] of Object.entries(userBets)) {
          const match = memoryDB.matches[mId];
          const details = match ? match.details : `Mecz ID ${mId}`;
          desc += `• **${details}**: Wygrana \`${betData.winner}\` | Wynik \`${betData.score}\`\n`;
        }
        return interaction.reply({ content: desc, ephemeral: true });
      }

      if (commandName === 'pickem') {
        const stage = options.getString('stage');
        const stageData = memoryDB.pickems.stages[stage];

        if (!stageData || !stageData.teams || stageData.teams.length === 0) {
          return interaction.reply({ content: `❌ Faza **${stage}** nie została jeszcze skonfigurowana przez administratora.`, ephemeral: true });
        }
        if (stageData.locked) {
          return interaction.reply({ content: `🔒 Faza **${stage}** jest obecnie zablokowana do typowania.`, ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`modal_pickem_${stage}`).setTitle(`Pick'Em: ${stage.toUpperCase()}`);
        const t30 = new TextInputBuilder().setCustomId('p_30').setLabel('2 drużyny 3-0 (rozdziel przecinkami)').setStyle(TextInputStyle.Short).setRequired(true);
        const t03 = new TextInputBuilder().setCustomId('p_03').setLabel('2 drużyny 0-3 (rozdziel przecinkami)').setStyle(TextInputStyle.Short).setRequired(true);
        const tAdv = new TextInputBuilder().setCustomId('p_adv').setLabel('6 drużyn z awansem (rozdziel przecinkami)').setStyle(TextInputStyle.Paragraph).setRequired(true);

        const components = [
          new ActionRowBuilder().addComponents(t30),
          new ActionRowBuilder().addComponents(t03),
          new ActionRowBuilder().addComponents(tAdv)
        ];

        if (stage === 'stage3') {
          const tMvp = new TextInputBuilder().setCustomId('p_mvp').setLabel('Twój typ na MVP Turnieju (Nick gracza)').setStyle(TextInputStyle.Short).setRequired(false);
          components.push(new ActionRowBuilder().addComponents(tMvp));
        }

        modal.addComponents(components);
        return await interaction.showModal(modal);
      }

      if (commandName === 'moje_pickemy') {
        const userId = interaction.user.id;
        const userPicks = memoryDB.pickems.userPicks[userId];
        const userMvp = memoryDB.pickems.mvpPicks ? memoryDB.pickems.mvpPicks[userId] : null;

        if ((!userPicks || Object.keys(userPicks).length === 0) && !userMvp) {
          return interaction.reply({ content: '📋 Nie masz jeszcze zapisanych żadnych typów Pick\'Em.', ephemeral: true });
        }

        let desc = '';
        if (userPicks) {
          for (const [stg, p] of Object.entries(userPicks)) {
            desc += `### 🏆 ${stg.toUpperCase()}\n`;
            desc += `• **3-0:** \`${p.threeZero}\`\n`;
            desc += `• **0-3:** \`${p.zeroThree}\`\n`;
            desc += `• **Awans (6):** \`${p.advancing}\`\n\n`;
          }
        }
        if (userMvp) {
          desc += `🌟 **Twój typ na MVP:** \`${userMvp}\`\n`;
        }

        return interaction.reply({ content: desc, ephemeral: true });
      }

      if (commandName === 'profil') {
        const u = memoryDB.users[interaction.user.id] || { points: 0 };
        return interaction.reply({ content: `📊 Twój profil:\n🏆 Punkty: **${u.points} pkt**`, ephemeral: true });
      }

      if (commandName === 'ranking') {
        const sorted = Object.entries(memoryDB.users).sort((a, b) => (b[1].points || 0) - (a[1].points || 0)).slice(0, 10);
        if (sorted.length === 0) return interaction.reply({ content: '🏆 Ranking jest obecnie pusty.', ephemeral: true });
        let desc = '';
        sorted.forEach(([id, data], i) => {
          desc += `${i + 1}. <@${id}> — **${data.points || 0} pkt**\n`;
        });
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏆 Tabela Liderów').setDescription(desc)] });
      }

      if (commandName === 'admin' && interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const sub = options.getSubcommand();

        if (sub === 'dodaj_mecz') {
          const teamA = options.getString('druzyna_a');
          const teamB = options.getString('druzyna_b');
          const format = options.getString('format');
          const lockStr = options.getString('data_blokady');
          const lockDateObj = parseCustomDate(lockStr);
          
          const mId = memoryDB.nextMatchId.toString();
          memoryDB.nextMatchId++;
          memoryDB.matches[mId] = {
            details: `${teamA} vs ${teamB}`,
            teamA, teamB, format,
            locked: false,
            lockDate: lockDateObj ? lockDateObj.toISOString() : null
          };
          await saveDB();
          return interaction.reply({ content: `✅ Dodano mecz ID ${mId}: **${teamA} vs ${teamB}** (${format})` });
        }

        if (sub === 'rozlicz_mecz') {
          const mId = options.getInteger('id').toString();
          const winner = options.getString('zwyciezca').trim().toLowerCase();
          const exactScore = options.getString('wynik').trim().replace(/\s+/g, '');

          const match = memoryDB.matches[mId];
          if (!match) return interaction.reply({ content: '❌ Nie znaleziono meczu o tym ID.', ephemeral: true });

          let processed = 0;
          for (const [userId, bets] of Object.entries(memoryDB.bets)) {
            const userBet = bets[mId];
            if (!userBet) continue;

            if (!memoryDB.users[userId]) memoryDB.users[userId] = { points: 0 };

            const userWinner = userBet.winner.trim().toLowerCase();
            const userScore = userBet.score.trim().replace(/\s+/g, '');

            if (userWinner === winner) {
              if (userScore === exactScore) {
                memoryDB.users[userId].points += 3;
              } else {
                memoryDB.users[userId].points += 1;
              }
              processed++;
            }
          }

          match.locked = true;
          await saveDB();
          return interaction.reply({ content: `🎉 Rozliczono mecz ID ${mId} (**${winner.toUpperCase()}**, Wynik: **${exactScore}**). Przyznano punkty **${processed}** graczom!` });
        }

        if (sub === 'pickem_setup') {
          const stage = options.getString('stage');
          const teams = options.getString('druzyny').split(',').map(t => t.trim()).filter(Boolean);
          if (!memoryDB.pickems.stages[stage]) memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
          memoryDB.pickems.stages[stage].teams = teams;
          await saveDB();
          return interaction.reply({ content: `✅ Skonfigurowano stage **${stage}** (${teams.length} drużyn).` });
        }

        if (sub === 'pickem_lock') {
          const stage = options.getString('stage');
          const status = options.getBoolean('status');
          if (!memoryDB.pickems.stages[stage]) memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
          memoryDB.pickems.stages[stage].locked = status;
          await saveDB();
          return interaction.reply({ content: `🔒 Status blokady dla **${stage}**: **${status}**` });
        }

        if (sub === 'pickem_rozlicz') {
          const stage = options.getString('stage');
          const official30 = options.getString('oficjalne_30').split(',').map(t => t.trim().toLowerCase());
          const official03 = options.getString('oficjalne_03').split(',').map(t => t.trim().toLowerCase());
          const officialAdv = options.getString('oficjalne_adv').split(',').map(t => t.trim().toLowerCase());

          let totalUsersProcessed = 0;

          for (const [userId, userStages] of Object.entries(memoryDB.pickems.userPicks || {})) {
            const pick = userStages[stage];
            if (!pick) continue;

            if (!memoryDB.users[userId]) memoryDB.users[userId] = { points: 0 };

            let earnedPoints = 0;
            const player30 = (pick.threeZero || '').split(',').map(t => t.trim().toLowerCase());
            const player03 = (pick.zeroThree || '').split(',').map(t => t.trim().toLowerCase());
            const playerAdv = (pick.advancing || '').split(',').map(t => t.trim().toLowerCase());

            player30.forEach(team => { if (official30.includes(team)) earnedPoints += 3; });
            player03.forEach(team => { if (official03.includes(team)) earnedPoints += 3; });
            playerAdv.forEach(team => { if (officialAdv.includes(team)) earnedPoints += 1; });

            memoryDB.users[userId].points += earnedPoints;
            totalUsersProcessed++;
          }

          await saveDB();
          return interaction.reply({ content: `🎉 Rozliczono Pick'Em dla **${stage}**! Przeliczono punkty dla **${totalUsersProcessed}** graczy.` });
        }

        if (sub === 'pickem_rozlicz_mvp') {
          const officialMvp = options.getString('gracz_mvp').trim().toLowerCase();
          let winnersCount = 0;

          for (const [userId, mvpPick] of Object.entries(memoryDB.pickems.mvpPicks || {})) {
            if (mvpPick.trim().toLowerCase() === officialMvp) {
              if (!memoryDB.users[userId]) memoryDB.users[userId] = { points: 0 };
              memoryDB.users[userId].points += 3;
              winnersCount++;
            }
          }

          await saveDB();
          return interaction.reply({ content: `🌟 Rozliczono MVP Major'a (**${officialMvp.toUpperCase()}**)! Dodano po 3 pkt dla **${winnersCount}** graczy.` });
        }

        if (sub === 'reset_ranking') {
          memoryDB.users = {};
          await saveDB();
          return interaction.reply({ content: '⚠️ Zresetowano punkty i statystyki wszystkich graczy w rankingu!', ephemeral: true });
        }
      }
    }

    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_match_to_bet') {
        const selectedValue = interaction.values[0];
        const mId = selectedValue.replace('typ_mecz_', '');
        const match = memoryDB.matches[mId];

        if (!match) return interaction.reply({ content: '❌ Ten mecz już nie istnieje.', ephemeral: true });
        if (match.locked) return interaction.reply({ content: '🔒 Typowanie tego meczu zostało już zablokowane.', ephemeral: true });

        const modal = new ModalBuilder().setCustomId(`modal_bet_match_${mId}`).setTitle(`Obstaw mecz: ${match.details}`);
        const tWinner = new TextInputBuilder()
          .setCustomId('b_winner')
          .setLabel(`Zwycięzca (${match.teamA} lub ${match.teamB})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const tScore = new TextInputBuilder()
          .s
