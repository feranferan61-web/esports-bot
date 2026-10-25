const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes } = require('discord.js');
const { Pool } = require('pg');
const http = require('http');
const slashCommands = require('./commands.js');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let memoryDB = {
  matches: {},
  users: {},
  bets: {},
  pickems: { stages: {}, userPicks: {} },
  userChannels: {},
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
          userPicks: loaded.pickems?.userPicks || {}
        },
        userChannels: loaded.userChannels || {},
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
  res.end('Bot Major 2026 dziala 24/7!\n');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 Serwer HTTP na porcie ${PORT}`));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

function getWarsawDate() {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Warsaw" });
  return new Date(nowStr);
}

function parseWarsawDate(dateStr) {
  if (!dateStr) return null;
  try {
    const [datePart, timePart] = dateStr.trim().split(' ');
    const [day, month, year] = datePart.split('-');
    const [hour, minute] = timePart.split(':');
    return new Date(year, month - 1, day, hour, minute);
  } catch (e) {
    return null;
  }
}

async function checkAndLockMatches() {
  const now = getWarsawDate();
  let changed = false;
  for (const [mId, m] of Object.entries(memoryDB.matches)) {
    if (!m.locked && m.closeDate && now >= new Date(m.closeDate)) {
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
    console.log('✅ Zarejestrowano komendy Slash!');
  } catch (err) {
    console.error('❌ Błąd rejestracji komend:', err);
  }
  setInterval(checkAndLockMatches, 30000);
  console.log(`✅ Bot ${client.user.tag} jest gotowy!`);
});

client.on('interactionCreate', async interaction => {
  try {
    await checkAndLockMatches();

    if (interaction.isChatInputCommand()) {
      const { commandName, options } = interaction;

      // 1. /mecze
      if (commandName === 'mecze') {
        const selectOptions = [];
        for (const [mId, m] of Object.entries(memoryDB.matches)) {
          if (m.locked) continue;
          selectOptions.push({ label: `Mecz ID ${mId}: ${m.details} (${m.format})`, value: `bet_match_${mId}` });
        }
        if (selectOptions.length === 0) {
          return interaction.reply({ content: 'Brak dostępnych meczów do typowania w tym momencie.', ephemeral: true });
        }
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('select_match_menu').setPlaceholder('Wybierz mecz do obstawienia...').addOptions(selectOptions)
        );
        return interaction.reply({ content: 'Wybierz mecz z poniższej listy:', components: [row], ephemeral: true });
      }

      // 2. /mojetypy
      if (commandName === 'mojetypy') {
        const userId = interaction.user.id;
        const userBets = memoryDB.bets[userId];
        if (!userBets || Object.keys(userBets).length === 0) {
          return interaction.reply({ content: '📋 Nie masz jeszcze żadnych typów na koncie.', ephemeral: true });
        }
        let desc = '### 🎯 Historia Twoich typów:\n';
        for (const [mId, b] of Object.entries(userBets)) {
          const match = memoryDB.matches[mId];
          const matchName = match ? match.details : `Usunięty mecz ID ${mId}`;
          const resultText = b.result !== undefined ? ` (Wynik: **${b.result === 3 ? '+3 pkt' : b.result === 1 ? '+1 pkt' : '0 pkt'}**)` : ' *(Oczekuje na rozliczenie)*';
          desc += `• **${matchName}**\n  ↳ Typ: Zwycięzca: \`${b.winner}\` | Wynik: \`${b.score}\`${resultText}\n`;
        }
        return interaction.reply({ content: desc, ephemeral: true });
      }

      // 3. /profil
      if (commandName === 'profil') {
        const userId = interaction.user.id;
        const u = memoryDB.users[userId] || { points: 0, totalBets: 0, correctBets: 0 };
        const accuracy = u.totalBets > 0 ? ((u.correctBets / u.totalBets) * 100).toFixed(1) : 0;

        return interaction.reply({
          content: `📊 **Twój Profil Typera:**\n` +
                   `🏆 Punkty: **${u.points} pkt**\n` +
                   `🎯 Obstawione mecze: **${u.totalBets}**\n` +
                   `✅ Trafione typy: **${u.correctBets}**\n` +
                   `📈 Skuteczność: **${accuracy}%**`,
          ephemeral: true
        });
      }

      // 4. /ranking
      if (commandName === 'ranking') {
        const sorted = Object.entries(memoryDB.users)
          .sort((a, b) => (b[1].points || 0) - (a[1].points || 0))
          .slice(0, 10);

        if (sorted.length === 0) {
          return interaction.reply({ content: '🏆 Ranking jest obecnie pusty. Nikt jeszcze nie zdobył punktów!', ephemeral: true });
        }

        let desc = '';
        sorted.forEach(([id, data], i) => {
          const acc = data.totalBets > 0 ? ((data.correctBets / data.totalBets) * 100).toFixed(0) : 0;
          desc += `${i + 1}. <@${id}> — **${data.points || 0} pkt** (Skuteczność: ${acc}%)\n`;
        });

        const embed = new EmbedBuilder()
          .setTitle('🏆 Tabela Liderów — TOP 10')
          .setDescription(desc)
          .setColor('#ffd700');

        return interaction.reply({ embeds: [embed] });
      }

      // 5. /moj_kanal
      if (commandName === 'moj_kanal') {
        const guild = interaction.guild;
        const user = interaction.user;

        if (!memoryDB.userChannels) memoryDB.userChannels = {};

        // Jeśli gracz ma już aktywny kanał, podajemy do niego odnośnik
        if (memoryDB.userChannels[user.id]) {
          const existingChannel = guild.channels.cache.get(memoryDB.userChannels[user.id]);
          if (existingChannel) {
            return interaction.reply({ content: `ℹ️ Masz już swój prywatny kanał: <#${existingChannel.id}>!`, ephemeral: true });
          }
        }

        const channelName = `typy-${user.username}`.toLowerCase().replace(/[^a-z0-9]/g, '');

        try {
          const privateChannel = await guild.channels.create({
            name: channelName,
            type: 0,
            topic: `Prywatny kanał do typowania dla gracza ${user.tag}`,
            permissionOverwrites: [
              {
                id: guild.id,
                deny: ['ViewChannel'],
              },
              {
                id: user.id,
                allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
              },
              {
                id: client.user.id,
                allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'],
              },
            ],
          });

          memoryDB.userChannels[user.id] = privateChannel.id;
          await saveDB();

          const embed = new EmbedBuilder()
            .setTitle(`🎯 Twój prywatny kącik typera, ${user.username}!`)
            .setDescription('Tutaj możesz w spokoju używać komend `/mecze`, `/mojetypy`, `/pickem` czy `/ranking`.\n\n**Nikt inny z serwera nie widzi tego kanału**, więc Twoje typy są całkowicie bezpieczne i poufne!')
            .setColor('#00ff00');

          await privateChannel.send({ content: `<@${user.id}>`, embeds: [embed] });

          return interaction.reply({ content: `✅ Stworzyłem dla Ciebie prywatny kanał: <#${privateChannel.id}>!`, ephemeral: true });
        } catch (error) {
          console.error('Błąd tworzenia prywatnego kanału:', error);
          return interaction.reply({ content: '❌ Nie udało się utworzyć kanału. Upewnij się, że bot ma uprawnienie "Zarządzanie kanałami" (Manage Channels) w ustawieniach serwera.', ephemeral: true });
        }
      }

      // 6. /druzyny
      if (commandName === 'druzyny') {
        const stage = options.getString('stage');
        const stageData = memoryDB.pickems.stages[stage];
        if (!stageData || !stageData.teams || stageData.teams.length === 0) {
          return interaction.reply({ content: `❌ Faza **${stage.toUpperCase()}** nie została jeszcze skonfigurowana przez administratora.`, ephemeral: true });
        }
        const list = stageData.teams.map((t, i) => `${i + 1}. **${t}**`).join('\n');
        const embed = new EmbedBuilder().setTitle(`🛡️ Drużyny w fazie ${stage.toUpperCase()}`).setDescription(list).setColor('#0099ff');
        return interaction.reply({ embeds: [embed], ephemeral: false });
      }

      // 7. /pickem
      if (commandName === 'pickem') {
        const stage = options.getString('stage');
        const stageData = memoryDB.pickems.stages[stage];
        if (!stageData || !stageData.teams || stageData.teams.length === 0) {
          return interaction.reply({ content: `❌ Faza **${stage}** nie jest skonfigurowana.`, ephemeral: true });
        }
        if (stageData.locked) {
          return interaction.reply({ content: `🔒 Typowanie dla tej fazy jest zablokowane.`, ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`modal_pickem_${stage}`).setTitle(`Pick'Em: ${stage.toUpperCase()}`);
        const t30 = new TextInputBuilder().setCustomId('p_30').setLabel('Bilans 3-0 (2 drużyny po przecinku)').setStyle(TextInputStyle.Short).setRequired(true);
        const t03 = new TextInputBuilder().setCustomId('p_03').setLabel('Bilans 0-3 (2 drużyny po przecinku)').setStyle(TextInputStyle.Short).setRequired(true);
        const tAdv = new TextInputBuilder().setCustomId('p_adv').setLabel('Awans do kolejnego stage (6 drużyn)').setStyle(TextInputStyle.Paragraph).setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(t30),
          new ActionRowBuilder().addComponents(t03),
          new ActionRowBuilder().addComponents(tAdv)
        );
        return await interaction.showModal(modal);
      }

      // --- ADMIN: /dodajmecz ---
      if (commandName === 'dodajmecz') {
        const teamA = options.getString('druzyna_a');
        const teamB = options.getString('druzyna_b');
        const format = options.getString('format');
        const dateStr = options.getString('data_zamkniecia');
        const closeDate = parseWarsawDate(dateStr);

        if (!closeDate) {
          return interaction.reply({ content: '❌ Błędny format daty! Użyj dokładnie formatu: `DD-MM-YYYY HH:mm` (np. `25-03-2026 15:30`).', ephemeral: true });
        }

        const mId = memoryDB.nextMatchId.toString();
        memoryDB.nextMatchId++;
        memoryDB.matches[mId] = {
          details: `${teamA} vs ${teamB}`,
          teamA, teamB, format,
          closeDate: closeDate.toISOString(),
          locked: false
        };
        await saveDB();
        return interaction.reply({ content: `✅ Dodano mecz ID **${mId}**: **${teamA} vs ${teamB}** (${format}). Zamknięcie: \`${dateStr}\` (Warszawa).` });
      }

      // --- ADMIN: /edytujmecz ---
      if (commandName === 'edytujmecz') {
        const mId = options.getInteger('id').toString();
        const match = memoryDB.matches[mId];
        if (!match) return interaction.reply({ content: '❌ Nie znaleziono meczu o takim ID.', ephemeral: true });

        const teamA = options.getString('druzyna_a');
        const teamB = options.getString('druzyna_b');
        const format = options.getString('format');
        const dateStr = options.getString('data_zamkniecia');

        if (teamA) match.teamA = teamA;
        if (teamB) match.teamB = teamB;
        if (teamA || teamB) match.details = `${match.teamA} vs ${match.teamB}`;
        if (format) match.format = format;
        if (dateStr) {
          const newDate = parseWarsawDate(dateStr);
          if (!newDate) return interaction.reply({ content: '❌ Błędny format daty (`DD-MM-YYYY HH:mm`).', ephemeral: true });
          match.closeDate = newDate.toISOString();
          match.locked = false;
        }

        await saveDB();
        return interaction.reply({ content: `✅ Zaktualizowano mecz ID **${mId}** (**${match.details}**).` });
      }

      // --- ADMIN: /usunmecz ---
      if (commandName === 'usunmecz') {
        const mId = options.getInteger('id').toString();
        if (!memoryDB.matches[mId]) return interaction.reply({ content: '❌ Nie znaleziono meczu o takim ID.', ephemeral: true });

        delete memoryDB.matches[mId];
        await saveDB();
        return interaction.reply({ content: `🗑️ Usunięto mecz ID **${mId}**.` });
      }

      // --- ADMIN: /rozliczmecz ---
      if (commandName === 'rozliczmecz') {
        const mId = options.getInteger('id').toString();
        const winner = options.getString('zwyciezca').trim().toLowerCase();
        const exactScore = options.getString('wynik').trim().replace(/\s+/g, '');

        const match = memoryDB.matches[mId];
        if (!match) return interaction.reply({ content: '❌ Nie znaleziono meczu o takim ID.', ephemeral: true });

        let processed = 0;
        for (const [userId, userBets] of Object.entries(memoryDB.bets)) {
          const bet = userBets[mId];
          if (!bet) continue;

          if (!memoryDB.users[userId]) {
            memoryDB.users[userId] = { points: 0, totalBets: 0, correctBets: 0 };
          }
          memoryDB.users[userId].totalBets++;

          const uWinner = bet.winner.trim().toLowerCase();
          const uScore = bet.score.trim().replace(/\s+/g, '');

          if (uWinner === winner) {
            if (uScore === exactScore) {
              memoryDB.users[userId].points += 3;
              memoryDB.users[userId].correctBets++;
              bet.result = 3;
            } else {
              memoryDB.users[userId].points += 1;
              memoryDB.users[userId].correctBets++;
              bet.result = 1;
            }
          } else {
            bet.result = 0;
          }
          processed++;
        }

        delete memoryDB.matches[mId];
        await saveDB();

        return interaction.reply({ content: `🎉 Rozliczono mecz ID **${mId}** (Zwycięzca: **${winner.toUpperCase()}**, Wynik: **${exactScore}**).\nPrzeliczono punkty dla **${processed}** graczy i usunięto mecz z listy!` });
      }

      // --- ADMIN: /utworzpickem ---
      if (commandName === 'utworzpickem') {
        const stage = options.getString('stage');
        const teams = options.getString('druzyny').split(',').map(t => t.trim()).filter(Boolean);

        if (!memoryDB.pickems.stages[stage]) {
          memoryDB.pickems.stages[stage] = { locked: false, teams: [] };
        }
        memoryDB.pickems.stages[stage].teams = teams;
        await saveDB();
        return interaction.reply({ content: `✅ Skonfigurowano drużyny dla fazy **${stage.toUpperCase()}** (${teams.length} drużyn).` });
      }

      // --- ADMIN: /rozliczpickem ---
      if (commandName === 'rozliczpickem') {
        const stage = options.getString('stage');
        const off30 = options.getString('oficjalne_30').split(',').map(t => t.trim().toLowerCase());
        const off03 = options.getString('oficjalne_03').split(',').map(t => t.trim().toLowerCase());
        const offAdv = options.getString('oficjalne_awans').split(',').map(t => t.trim().toLowerCase());

        let count = 0;
        for (const [userId, userStages] of Object.entries(memoryDB.pickems.userPicks || {})) {
          const p = userStages[stage];
          if (!p) continue;

          if (!memoryDB.users[userId]) {
            memoryDB.users[userId] = { points: 0, totalBets: 0, correctBets: 0 };
          }

          let earned = 0;
          p.threeZero?.split(',').map(t => t.trim().toLowerCase()).forEach(t => { if (off30.includes(t)) earned += 3; });
          p.zeroThree?.split(',').map(t => t.trim().toLowerCase()).forEach(t => { if (off03.includes(t)) earned += 3; });
          p.advancing?.split(',').map(t => t.trim().toLowerCase()).forEach(t => { if (offAdv.includes(t)) earned += 1; });

          memoryDB.users[userId].points += earned;
          count++;
        }

        await saveDB();
        return interaction.reply({ content: `🎉 Rozliczono Pick'Em dla **${stage.toUpperCase()}**! Przyznano punkty dla **${count}** graczy.` });
      }

      // --- ADMIN: /resetranking ---
      if (commandName === 'resetranking') {
        memoryDB.users = {};
        await saveDB();
        return interaction.reply({ content: '⚠️ **Zresetowano ranking!** Punkty i statystyki wszystkich graczy zostały wyczyszczone.', ephemeral: true });
      }
    }

    // --- OBSŁUGA SELECT MENU ---
    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'select_match_menu') {
        const mId = interaction.values[0].replace('bet_match_', '');
        const match = memoryDB.matches[mId];
        if (!match || match.locked) {
          return interaction.reply({ content: '❌ Ten mecz już nie istnieje lub został zablokowany.', ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`modal_bet_${mId}`).setTitle(`Obstaw: ${match.details}`);
        const tWinner = new TextInputBuilder().setCustomId('b_winner').setLabel(`Zwycięzca (${match.teamA} lub ${match.teamB})`).setStyle(TextInputStyle.Short).setRequired(true);
        const tScore = new TextInputBuilder().setCustomId('b_score').setLabel(`Dokładny wynik (${match.format}: np. 13-8)`).setStyle(TextInputStyle.Short).setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(tWinner),
          new ActionRowBuilder().addComponents(tScore)
        );
        return await interaction.showModal(modal);
      }
    }

    // --- OBSŁUGA FORMULARZY MODAL ---
    else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal_bet_')) {
        const mId = interaction.customId.replace('modal_bet_', '');
        const match = memoryDB.matches[mId];
        if (!match || match.locked) {
          return interaction.reply({ content: '❌ Mecz jest zablokowany lub niedostępny.', ephemeral: true });
        }

        const winner = interaction.fields.getTextInputValue('b_winner').trim();
        const score = interaction.fields.getTextInputValue('b_score').trim();

        if (!memoryDB.bets[interaction.user.id]) memoryDB.bets[interaction.user.id] = {};
        memoryDB.bets[interaction.user.id][mId] = { winner, score };

        await saveDB();
        return interaction.reply({ content: `🎯 Zapisano Twój typ na mecz **${match.details}**!\n• Zwycięzca:
