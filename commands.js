const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

const slashCommands = [
  new SlashCommandBuilder()
    .setName('mojpickem')
    .setDescription('Sprawdź swoje zapisane typy Pick\'Em')
    .addStringOption(option =>
      option.setName('stage')
        .setDescription('Wybierz fazę turnieju')
        .setRequired(true)
        .addChoices(
          { name: 'Opening Stage', value: 'opening' },
          { name: 'Elimination Stage', value: 'elimination' },
          { name: 'Playoffs', value: 'playoffs' }
        )
    ),

  new SlashCommandBuilder()
    .setName('mecze')
    .setDescription('Wyświetl dostępne mecze do obstawienia'),

  new SlashCommandBuilder()
    .setName('mojetypy')
    .setDescription('Sprawdź swoje aktualnie postawione typy na mecze'),

  new SlashCommandBuilder()
    .setName('profil')
    .setDescription('Wyświetl swój profil typera i statystyki'),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Wyświetl TOP 10 graczy w rankingu punktowym'),

  new SlashCommandBuilder()
    .setName('ustaw_kanal_rankingu')
    .setDescription('[Admin] Ustawia kanał, na który codziennie będzie wysyłany ranking')
    .addChannelOption(opt => 
      opt.setName('kanal')
         .setDescription('Wybierz kanał tekstowy')
         .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('moj_kanal')
    .setDescription('Stwórz swój prywatny kanał do typowania'),

  new SlashCommandBuilder()
    .setName('druzyny')
    .setDescription('Wyświetl listę drużyn w danej fazie Pick\'Em')
    .addStringOption(option =>
      option.setName('stage')
        .setDescription('Wybierz fazę')
        .setRequired(true)
        .addChoices(
          { name: 'Opening Stage', value: 'opening' },
          { name: 'Elimination Stage', value: 'elimination' },
          { name: 'Playoffs', value: 'playoffs' }
        )
    ),

  new SlashCommandBuilder()
    .setName('pickem')
    .setDescription('Wypełnij lub edytuj swoje typy Pick\'Em')
    .addStringOption(option =>
      option.setName('stage')
        .setDescription('Wybierz fazę')
        .setRequired(true)
        .addChoices(
          { name: 'Opening Stage', value: 'opening' },
          { name: 'Elimination Stage', value: 'elimination' },
          { name: 'Playoffs', value: 'playoffs' }
        )
    ),

  new SlashCommandBuilder()
    .setName('zamknijpickem')
    .setDescription('[Admin] Zablokuj edycję typów Pick\'Em dla wybranej fazy')
    .addStringOption(option =>
      option.setName('stage')
        .setDescription('Wybierz fazę do zamknięcia')
        .setRequired(true)
        .addChoices(
          { name: 'Opening Stage', value: 'opening' },
          { name: 'Elimination Stage', value: 'elimination' },
          { name: 'Playoffs', value: 'playoffs' }
        )
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('dodajmecz')
    .setDescription('[Admin] Dodaj nowy mecz do obstawiania')
    .addStringOption(opt => opt.setName('druzyna_a').setDescription('Nazwa drużyny A').setRequired(true))
    .addStringOption(opt => opt.setName('druzyna_b').setDescription('Nazwa drużyny B').setRequired(true))
    .addStringOption(opt => 
      opt.setName('format')
         .setDescription('Format meczu')
         .setRequired(true)
         .addChoices(
           { name: 'BO1', value: 'BO1' },
           { name: 'BO3', value: 'BO3' },
           { name: 'BO5', value: 'BO5' }
         )
    )
    .addStringOption(opt => opt.setName('data_zamkniecia').setDescription('Data i godzina w formacie: DD-MM-YYYY HH:mm').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('edytujmecz')
    .setDescription('[Admin] Edytuj istniejący mecz')
    .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu').setRequired(true))
    .addStringOption(opt => opt.setName('druzyna_a').setDescription('Nowa drużyna A').setRequired(false))
    .addStringOption(opt => opt.setName('druzyna_b').setDescription('Nowa drużyna B').setRequired(false))
    .addStringOption(opt => 
      opt.setName('format')
         .setDescription('Nowy format')
         .setRequired(false)
         .addChoices(
           { name: 'BO1', value: 'BO1' },
           { name: 'BO3', value: 'BO3' },
           { name: 'BO5', value: 'BO5' }
         )
    )
    .addStringOption(opt => opt.setName('data_zamkniecia').setDescription('Nowa data (DD-MM-YYYY HH:mm)').setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('usunmecz')
    .setDescription('[Admin] Usuń mecz po ID')
    .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('rozliczmecz')
    .setDescription('[Admin] Rozlicz zakończony mecz i przyznaj punkty')
    .addIntegerOption(opt => opt.setName('id').setDescription('ID meczu').setRequired(true))
    .addStringOption(opt => opt.setName('zwyciezca').setDescription('Nazwa zwycięskiej drużyny').setRequired(true))
    .addStringOption(opt => opt.setName('wynik').setDescription('Wynik w mapach (np. 2:0)').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('utworzpickem')
    .setDescription('[Admin] Skonfiguruj drużyny dla danej fazy Pick\'Em')
    .addStringOption(option =>
      option.setName('stage')
        .setDescription('Wybierz fazę')
        .setRequired(true)
        .addChoices(
          { name: 'Opening Stage', value: 'opening' },
          { name: 'Elimination Stage', value: 'elimination' },
          { name: 'Playoffs', value: 'playoffs' }
        )
    )
    .addStringOption(opt => opt.setName('druzyny').setDescription('Lista drużyn oddzielona przecinkami').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('rozliczpickem')
    .setDescription('[Admin] Rozlicz punkty Pick\'Em dla wybranej fazy')
    .addStringOption(option =>
      option.setName('stage')
        .setDescription('Wybierz fazę')
        .setRequired(true)
        .addChoices(
          { name: 'Opening Stage', value: 'opening' },
          { name: 'Elimination Stage', value: 'elimination' },
          { name: 'Playoffs', value: 'playoffs' }
        )
    )
    .addStringOption(opt => opt.setName('oficjalne_30').setDescription('Drużyny 3-0 (po przecinku)').setRequired(true))
    .addStringOption(opt => opt.setName('oficjalne_03').setDescription('Drużyny 0-3 (po przecinku)').setRequired(true))
    .addStringOption(opt => opt.setName('oficjalne_awans').setDescription('Drużyny które awansowały (po przecinku)').setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName('resetranking')
    .setDescription('[Admin] Resetuje punkty wszystkich użytkowników')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
].map(command => command.toJSON());

module.exports = slashCommands;
      
