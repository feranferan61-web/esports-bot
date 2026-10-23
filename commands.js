const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

const slashCommands = [
  // --- KOMENDY DLA GRACZY ---
  new SlashCommandBuilder()
    .setName('mecze')
    .setDescription('Pokazuje dostępne mecze do typowania i panel wybierania meczu'),

  new SlashCommandBuilder()
    .setName('mojetypy')
    .setDescription('Pokazuje historię Twoich wszystkich typów'),

  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Pokazuje ile masz punktów i jaką masz skuteczność'),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Wyświetla tabelę liderów z TOP 10 graczy na serwerze'),

  new SlashCommandBuilder()
    .setName('druzyny')
    .setDescription('Pokazuje drużyny, które grają w konkretnym stage Major\'a')
    .addStringOption(opt => 
      opt.setName('stage')
         .setDescription('Wybierz stage')
         .setRequired(true)
         .addChoices(
           { name: 'Stage 1', value: 'stage1' },
           { name: 'Stage 2', value: 'stage2' },
           { name: 'Stage 3', value: 'stage3' }
         )
    ),

  new SlashCommandBuilder()
    .setName('pickem')
    .setDescription('Wybierz swoje typy Pick\'Em (3-0, 0-3, awanse)')
    .addStringOption(opt => 
      opt.setName('stage')
         .setDescription('Wybierz stage')
         .setRequired(true)
         .addChoices(
           { name: 'Stage 1', value: 'stage1' },
           { name: 'Stage 2', value: 'stage2' },
           { name: 'Stage 3', value: 'stage3' }
         )
    ),

  // --- KOMENDY ADMINISTRACYJNE ---
  new SlashCommandBuilder()
    .setName('dodajmecz')
    .setDescription('[Admin] Dodaje nowy mecz do typowania')
    .addStringOption(opt => opt.setName('druzyna_a').setDescription('Drużyna A').setRequired(true))
    .addStringOption(opt => opt.setName('druzyna_b').setDescription('Drużyna B').setRequired(true))
    .addStringOption(opt => opt.setName('format').setDescription('Format (np. BO1 lub BO3)').setRequired(true))
    .addStringOption(opt => opt.setName('data_zamkniecia').setDescription('Data zamknięcia (DD-MM-YYYY HH:mm - czas w Warszawie)').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('edytujmecz')
    .setDescription('[Admin] Edytuje istniejący mecz')
    .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu do edycji').setRequired(true))
    .addStringOption(opt => opt.setName('druzyna_a').setDescription('Nowa drużyna A').setRequired(false))
    .addStringOption(opt => opt.setName('druzyna_b').setDescription('Nowa drużyna B').setRequired(false))
    .addStringOption(opt => opt.setName('format').setDescription('Nowy format').setRequired(false))
    .addStringOption(opt => opt.setName('data_zamkniecia').setDescription('Nowa data (DD-MM-YYYY HH:mm)').setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('usunmecz')
    .setDescription('[Admin] Usuwa mecz')
    .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu do usunięcia').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('rozliczmecz')
    .setDescription('[Admin] Rozlicza mecz i automatycznie przyznaje punkty')
    .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu').setRequired(true))
    .addStringOption(opt => opt.setName('zwyciezca').setDescription('Nazwa zwycięskiej drużyny').setRequired(true))
    .addStringOption(opt => opt.setName('wynik').setDescription('Dokładny wynik (np. 13-8 lub 2-1)').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('utworzpickem')
    .setDescription('[Admin] Konfiguruje drużyny dla Pick\'Em w danej fazie')
    .addStringOption(opt => 
      opt.setName('stage')
         .setDescription('Wybierz stage')
         .setRequired(true)
         .addChoices(
           { name: 'Stage 1', value: 'stage1' },
           { name: 'Stage 2', value: 'stage2' },
           { name: 'Stage 3', value: 'stage3' }
         )
    )
    .addStringOption(opt => opt.setName('druzyny').setDescription('Lista drużyn oddzielona przecinkami').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('rozliczpickem')
    .setDescription('[Admin] Rozlicza Pick\'Em dla danej fazy')
    .addStringOption(opt => 
      opt.setName('stage')
         .setDescription('Wybierz stage')
         .setRequired(true)
         .addChoices(
           { name: 'Stage 1', value: 'stage1' },
           { name: 'Stage 2', value: 'stage2' },
           { name: 'Stage 3', value: 'stage3' }
         )
    )
    .addStringOption(opt => opt.setName('oficjalne_30').setDescription('Oficjalne 3-0 (2 drużyny po przecinku)').setRequired(true))
    .addStringOption(opt => opt.setName('oficjalne_03').setDescription('Oficjalne 0-3 (2 drużyny po przecinku)').setRequired(true))
    .addStringOption(opt => opt.setName('oficjalne_awans').setDescription('Oficjalne awanse (6 drużyn po przecinku)').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('resetranking')
    .setDescription('⚠️ [Admin] Resetuje punkty i statystyki wszystkich graczy do zera')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
].map(cmd => cmd.toJSON());

module.exports = slashCommands;
  
