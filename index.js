const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs');

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
        const initialData = { matches: {}, users: {}, settings: { locked: false } };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.settings) data.settings = { locked: false };
    return data;
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

client.once('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}! Bot w chmurze działa.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const db = loadDB();

    // --- KOMENDY ADMINISTRATORA ---

    if (command === 'dodajmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const matchDetails = args.slice(1).join(' ');
        if (!matchId || !matchDetails) return message.reply('❌ Użycie: `!dodajmecz [ID] [Nazwa]`');
        db.matches[matchId] = { details: matchDetails };
        saveDB(db);
        return message.reply(`✅ Dodano mecz **ID: ${matchId}** (${matchDetails}).`);
    }

    if (command === 'edytujmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const newDetails = args.slice(1).join(' ');
        if (!matchId || !newDetails) return message.reply('❌ Użycie: `!edytujmecz [ID] [Nowa nazwa]`');
        if (!db.matches[matchId]) return message.reply('❌ Taki mecz nie istnieje!');
        
        db.matches[matchId].details = newDetails;
        saveDB(db);
        return message.reply(`✅ Zaktualizowano mecz **ID: ${matchId}** na: *${newDetails}*`);
    }

    if (command === 'usunmecz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        if (!matchId) return message.reply('❌ Użycie: `!usunmecz [ID]`');
        if (!db.matches[matchId]) return message.reply('❌ Taki mecz nie istnieje!');

        delete db.matches[matchId];
        saveDB(db);
        return message.reply(`🗑️ Usunięto mecz o ID: **${matchId}**`);
    }

    if (command === 'zamknij') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = true;
        saveDB(db);
        return message.reply('🔒 Typowanie zostało **zamknięte**.');
    }
    
    if (command === 'otworz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.settings.locked = false;
        saveDB(db);
        return message.reply('🔓 Typowanie zostało **otwarte**.');
    }

    if (command === 'resetranking') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        db.users = {};
        saveDB(db);
        return message.reply('🔄 Ranking oraz historia typów wszystkich graczy zostały zresetowane.');
    }

    if (command === 'rozlicz') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Brak uprawnień!');
        const matchId = args[0];
        const winner = args[1];
        const exactScore = args.slice(2).join(' ');
        if (!matchId || !winner || !exactScore) return message.reply('❌ Użycie: `!rozlicz [ID] [Zwycięzca] [Dokładny Wynik]`');

        let resultsSummary = `⚔️ **Rozliczenie meczu ID: ${matchId}**\n🏆 Wynik: **${winner} ${exactScore}**\n\n`;
        let count = 0;

        for (const userId in db.users) {
            const p = db.users[userId].predictions[matchId];
            if (!p) continue;
            count++;
            if (!db.users[userId].points) db.users[userId].points = 0;

            if (p.toLowerCase() === `${winner} ${exactScore}`.toLowerCase()) {
                db.users[userId].points += 3;
                resultsSummary += `🎯 <@${userId}> trafił **dokładny wynik** (${p})! **+3 pkt**\n`;
            } else if (p.toLowerCase().includes(winner.toLowerCase())) {
                db.users[userId].points += 1;
                resultsSummary += `✅ <@${userId}> trafił zwycięzcę (${p})! **+1 pkt**\n`;
            } else {
                resultsSummary += `❌ <@${userId}> pomylił się (${p}). 0 pkt\n`;
            }
        }
        saveDB(db);
        if (count === 0) return message.reply(`⚠️ Żaden użytkownik nie obstawił meczu ID ${matchId}.`);
        return message.channel.send(resultsSummary);
    }

    // --- KOMENDY DLA GRACZY ---

    if (command === 'mecze') {
        const matchKeys = Object.keys(db.matches);
        if (matchKeys.length === 0) return message.reply('📌 Brak aktywnych meczów.');
        let desc = '';
        for (const mId of matchKeys) {
            desc += `• **ID ${mId}**: ${db.matches[mId].details}\n`;
        }
        const embed = new EmbedBuilder().setTitle('📋 Lista aktywnych meczów').setDescription(desc).setColor(0x0099FF);
        return message.reply({ embeds: [embed] });
    }

    if (command === 'typ') {
        if (db.settings.locked) return message.reply('❌ Typowanie jest aktualnie zablokowane przez administratora!');
        const matchId = args[0];
        const pred = args.slice(1).join(' ');
        if (!matchId || !pred) return message.reply('❌ Użycie: `!typ [ID_meczu] [Twój typ]`');
        if (!db.matches[matchId]) return message.reply('❌ Taki mecz nie istnieje!');

        const userId = message.author.id;
        if (!db.users[userId]) db.users[userId] = { predictions: {}, points: 0 };
        db.users[userId].predictions[matchId] = pred;
        saveDB(db);
        return message.reply(`✅ <@${userId}>, zapisano typ: **${pred}** dla meczu ID **${matchId}**.`);
    }

    if (command === 'mojetypy') {
        const userData = db.users[message.author.id];
        if (!userData || Object.keys(userData.predictions).length === 0) return message.reply('📌 Brak zapisanych typów.');
        let desc = '';
        for (const mId in userData.predictions) {
            const matchName = db.matches[mId] ? db.matches[mId].details : 'Mecz usunięty';
            desc += `• **[ID ${mId}]** ${matchName} ➔ **${userData.predictions[mId]}**\n`;
        }
        const embed = new EmbedBuilder().setTitle('Twoje typy').setDescription(desc).setColor(0x00AE86);
        return message.reply({ embeds: [embed], ephemeral: true });
    }

    if (command === 'historia') {
        const userData = db.users[message.author.id];
        if (!userData || Object.keys(userData.predictions).length === 0) return message.reply('📜 Nie masz jeszcze żadnej historii typów.');
        
        let desc = `Masz aktualnie **${userData.points || 0} pkt**.\n\n**Twoje dotychczasowe typy:**\n`;
        for (const mId in userData.predictions) {
            const matchName = db.matches[mId] ? db.matches[mId].details : 'Mecz zakończony/usunięty';
            desc += `• Mecz ID **${mId}** (${matchName}): ` + `\`${userData.predictions[mId]}\`\n`;
        }
        
        const embed = new EmbedBuilder()
            .setTitle('📜 Twoja historia typów')
            .setDescription(desc)
            .setColor(0x9B59B6);
            
        return message.reply({ embeds: [embed], flags: 64 }); // 64 ukrywa wiadomość, widzi ją tylko dany gracz
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
});

client.login(TOKEN);
            
