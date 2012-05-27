/*jshint strict:true node:true es5:true onevar:true laxcomma:true laxbreak:true*/
(function () {
  "use strict";
  // simple server with a protected resource at /secret secured by OAuth 2

  var OAuth2Provider
    , connect = require('connect')
    , MemoryStore = connect.session.MemoryStore
    , myClients
    , myGrants
    , myOAP
    , app
    ;

  connect.router = require('connect_router');
  OAuth2Provider = require('oauth2-provider').OAuth2Provider;

  // hardcoded list of <client id, client secret> tuples
  myClients = {
   '1': '1secret',
  };

  // temporary grant storage
  myGrants = {};

  myOAP = new OAuth2Provider('encryption secret', 'signing secret');

  // before showing authorization page, make sure the user is logged in
  myOAP.on('enforce_login', function(req, res, authorize_url, next) {
    if(req.session.user) {
      next(req.session.user);
    } else {
      res.writeHead(303, {Location: '/login?next=' + encodeURIComponent(authorize_url)});
      res.end();
    }
  });

  // render the authorize form with the submission URL
  // use two submit buttons named "allow" and "deny" for the user's choice
  myOAP.on('authorize_form', function(req, res, client_id, authorize_url) {
    res.end('<html>this app wants to access your account... <form method="post" action="' + authorize_url + '"><button name="allow">Allow</button><button name="deny">Deny</button></form>');
  });

  // save the generated grant code for the current user
  myOAP.on('save_grant', function(req, client_id, code, next) {
    if(!(req.session.user in myGrants))
      myGrants[req.session.user] = {};

    myGrants[req.session.user][client_id] = code;
    next();
  });

  // remove the grant when the access token has been sent
  myOAP.on('remove_grant', function(user_id, client_id, code) {
    if(myGrants[user_id] && myGrants[user_id][client_id])
      delete myGrants[user_id][client_id];
  });

  // find the user for a particular grant
  myOAP.on('lookup_grant', function(client_id, client_secret, code, next) {
    var user
      , clients
      ;

    // verify that client id/secret pair are valid
    if(client_id in myClients && myClients[client_id] == client_secret) {
      for(user in myGrants) {
        clients = myGrants[user];

        if(clients[client_id] && clients[client_id] == code)
          return next(null, user);
      }
    }

    next(new Error('no such grant found'));
  });

  // embed an opaque value in the generated access token
  myOAP.on('create_access_token', function(user_id, client_id, next) {
    var data = {
      "github_login_attempt_failed": false
    }; // can be any data type or null

    next(data);
  });

  // an access token was received in a URL query string parameter or HTTP header
  myOAP.on('access_token', function(req, token, next) {
    var TOKEN_TTL = 10 * 60 * 1000; // 10 minutes

    if(token.grant_date.getTime() + TOKEN_TTL > Date.now()) {
      req.session.user = token.user_id;
      req.session.data = token.extra_data;
    } else {
      console.warn('access token for user %s has expired', token.user_id);
    }

    next();
  });

  function router(rest) {
    rest.get('/', function(req, res, next) {
      res.end('home, logged in? ' + !!req.session.user);
    });

    rest.get('/login', function(req, res, next) {
      console.log(req.session);
      if(req.session.user) {
        res.writeHead(303, {Location: '/'});
        return res.end();
      }

      var next_url = req.query.next ? req.query.next : '/';

      res.end('<html><form method="post" action="/login"><input type="hidden" name="next" value="' + next_url + '"><input type="text" placeholder="username" name="username"><input type="password" placeholder="password" name="password"><button type="submit">Login</button></form>');
    });

    rest.post('/login', function(req, res, next) {
      console.log('req.body', req.body);
      req.session.user = req.body.username;

      res.writeHead(303, {Location: req.body.next || '/'});
      res.end();
    });

    rest.get('/logout', function(req, res, next) {
      req.session.destroy(function(err) {
        res.writeHead(303, {Location: '/'});
        res.end();
      });
    });

    rest.get('/secret', function(req, res, next) {
      if(req.session.user) {
        res.end('proceed to secret lair, extra data: ' + JSON.stringify(req.session.data));
      } else {
        res.writeHead(403);
        res.end('no');
      }
    });
  }

  app = connect.createServer()
    //.use(connect.logger())
    .use(connect.favicon())
    .use(connect.json())
    .use(connect.urlencoded())
    .use(connect.query())
    .use(connect.cookieParser('keyboard cat'))
    .use(connect.session({ cookie: { maxAge: 60000 }}))
    //.use(connect.session({store: new MemoryStore({reapInterval: 5 * 60 * 1000}), secret: 'abracadabra'}))
    .use(myOAP.oauth())
    .use(myOAP.login())
    .use(connect.router(router))
    .use(function(req, res, next){
      var sess = req.session;
      if (sess.views) {
        res.setHeader('Content-Type', 'text/html');
        res.write('<p>views: ' + sess.views + '</p>');
        res.write('<p>expires in: ' + (sess.cookie.maxAge / 1000) + 's</p>');
        res.end();
        sess.views++;
      } else {
        sess.views = 1;
        res.end('welcome to the session demo. refresh!');
      }
    })
  ;

  function escape_entities(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  module.exports = app;
}());