var express = require('express');
var router = express.Router();
var passport = require('passport');
var util = require('util');
var url = require('url');
var querystring = require('querystring');
const settings = require('./settings.json');

// Perform the login, after login Auth0 will redirect to callback
router.get('/login', passport.authenticate('auth0', {
  scope: 'openid email profile'
}), function (req, res) {
  res.redirect('/admin/listversions');
});

// Perform the final stage of authentication and redirect to previously requested URL or '/user'
router.get('/callback', function (req, res, next) {
  passport.authenticate('auth0', function (err, user, info) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.redirect('/admin/login');
    }
    req.logIn(user, function (err) {
      if (err) {
        return next(err);
      }
      const returnTo = req.session.returnTo ? '/admin/' + req.session.returnTo : req.session.returnTo;
      delete req.session.returnTo;
      res.redirect(returnTo || '/admin/listversions');
    });
  })(req, res, next);
});

// Perform session logout and redirect to homepage
router.get('/logout', (req, res) => {
  req.logout();

  var returnTo = req.protocol + '://' + req.hostname;
  var port = req.connection.localPort;
  if (port !== undefined && port !== 80 && port !== 443) {
    returnTo += ':' + port;
  }
  var logoutURL = new URL(
    util.format('https://%s/logout', settings.AUTH0_LOGIN_DOMAIN)
  );
  var searchString = querystring.stringify({
    client_id: settings.AUTH0_WEB_CLIENTID,
    returnTo: returnTo
  });
  logoutURL.search = searchString;

  res.redirect(logoutURL);
});

module.exports = router;