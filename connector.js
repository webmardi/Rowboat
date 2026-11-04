/* global TrelloPowerUp, CONFIG */
const ICON = new URL('./icon.svg', window.location.href).href;

TrelloPowerUp.initialize({
  'board-buttons': function () {
    return [{
      icon: { dark: ICON, light: ICON },
      text: 'Rowboat',
      callback: function (t) {
        return t.modal({
          url: './import.html',
          title: 'Rowboat – Import cards from CSV',
          fullscreen: false,
          height: 760,
          accentColor: '#0C66E4'
        });
      }
    }];
  }
}, {
  appKey: CONFIG.APP_KEY,
  appName: CONFIG.APP_NAME,
  appAuthor: CONFIG.APP_AUTHOR
});
