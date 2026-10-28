/* Matematik Cepte — Firebase bağlantısı (web ve APK sürümü).
   claude.ai dışında çalışırken uygulamanın kullandığı window.claude.use('db' | 'user') arayüzünü
   Firebase Authentication + Cloud Firestore ile sağlar. Uygulama kodu iki ortamda da aynı kalır.
   Giriş yapılmadan veri katmanı açılmaz; giriş ekranını bu dosya yönetir. */
(function () {
  'use strict';
  if (window.claude || !window.firebase || !window.MC_FIREBASE_CONFIG) return;

  firebase.initializeApp(window.MC_FIREBASE_CONFIG);
  var auth = firebase.auth(), fs = firebase.firestore();
  try { auth.languageCode = 'tr'; } catch (e) {}

  var oturumAc, oturum = new Promise(function (r) { oturumAc = r; });
  var ben = null, rol = 'standart', ad = '', bekleyenAd = '', cikiliyor = false;
  var ROLLER = { matematikci: 1, gelistirici: 1 };

  /* Firestore iç içe diziyi saklamaz (el yazısı çizgileri böyle): [[..]] → [{__d: [..]}] ve geri */
  function enc(x) {
    if (Array.isArray(x)) return x.map(function (e) { return Array.isArray(e) ? { __d: enc(e) } : enc(e); });
    if (x && typeof x === 'object') { var o = {}; Object.keys(x).forEach(function (k) { if (x[k] !== undefined) o[k] = enc(x[k]); }); return o; }
    return x;
  }
  function dec(x) {
    if (Array.isArray(x)) return x.map(function (e) { return e && typeof e === 'object' && !Array.isArray(e) && Array.isArray(e.__d) && Object.keys(e).length === 1 ? dec(e.__d) : dec(e); });
    if (x && typeof x === 'object' && !(x instanceof Date) && typeof x.toMillis !== 'function') { var o = {}; Object.keys(x).forEach(function (k) { o[k] = dec(x[k]); }); return o; }
    return x;
  }
  function hata(e) {
    var c = e && e.code;
    return { code: c === 'permission-denied' || c === 'invalid-argument' ? 'invalid_argument' : c === 'resource-exhausted' ? 'resource_exhausted' : 'unavailable', message: String((e && e.message) || e) };
  }
  function snapD(s) {
    var d;
    return { id: s.id, exists: s.exists, metadata: s.metadata, data: function () { if (!s.exists) return undefined; if (d === undefined) d = dec(s.data()); return d; } };
  }
  function snapQ(q) {
    var docs = q.docs.map(snapD);
    return {
      docs: docs, size: q.size, empty: q.empty, metadata: q.metadata,
      docChanges: function () { return q.docChanges().map(function (c) { return { type: c.type, doc: snapD(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex }; }); }
    };
  }
  function docRef(ref) {
    return {
      id: ref.id, path: ref.path,
      get: function () { return ref.get().then(snapD, function (e) { throw hata(e); }); },
      set: function (b) { return ref.set(enc(b)).then(function () {}, function (e) { throw hata(e); }); },
      update: function (b) { return ref.update(enc(b)).then(function () {}, function (e) { throw hata(e); }); },
      delete: function () { return ref.delete().then(function () {}, function (e) { throw hata(e); }); },
      onSnapshot: function (next, err) { return ref.onSnapshot(function (s) { next(snapD(s)); }, function (e) { if (err) err(hata(e)); }); },
      collection: function (p) { return colRef(ref.collection(p)); }
    };
  }
  function sorgu(q) {
    return {
      where: function (f, op, v) { return sorgu(q.where(f, op, v)); },
      orderBy: function (f, d) { return sorgu(q.orderBy(f, d || 'asc')); },
      limit: function (n) { return sorgu(q.limit(n)); },
      get: function () { return q.get().then(snapQ, function (e) { throw hata(e); }); },
      onSnapshot: function (next, err) { return q.onSnapshot(function (s) { next(snapQ(s)); }, function (e) { if (err) err(hata(e)); }); }
    };
  }
  function colRef(c) {
    var o = sorgu(c);
    o.path = c.path;
    o.doc = function (id) { return docRef(id ? c.doc(id) : c.doc()); };
    o.add = function (b) { return c.add(enc(b)).then(docRef, function (e) { throw hata(e); }); };
    return o;
  }
  var dbApi = Object.freeze({
    collection: function (p) { return colRef(fs.collection(p)); },
    doc: function (p) { return docRef(fs.doc(p)); }
  });

  /* Kişiler: adlar profil/<id> belgelerinde; avatar adın baş harflerinden */
  var RENK = ['#2563EB', '#16A34A', '#D97706', '#DB2777', '#7C3AED', '#0D9488', '#DC2626'], prof = {};
  function renk(id) { var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return RENK[h % RENK.length]; }
  function harf(n) { var w = String(n || '').trim().split(/\s+/); return ((w[0] || '?').charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toLocaleUpperCase('tr-TR'); }
  function avatar(n, c) {
    var t = harf(n).replace(/[<>&"]/g, '');
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="' + c + '"/><text x="20" y="26" font-family="system-ui,sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#fff">' + t + '</text></svg>');
  }
  function profilOku(id) {
    var c = prof[id];
    if (c && Date.now() - c.t < 60000) return Promise.resolve(c.ad);
    return fs.doc('profil/' + id).get().then(function (s) {
      var a = s.exists && typeof (s.data() || {}).ad === 'string' ? s.data().ad.slice(0, 60) : '';
      prof[id] = { ad: a, t: Date.now() }; return a;
    }, function () { return c ? c.ad : ''; });
  }
  function kisi(id, n) { var c = renk(id); return { id: id, name: n || '', avatarUrl: avatar(n, c), color: c, isMe: !!ben && id === ben.uid, guest: false }; }
  var userApi = Object.freeze({
    id: function () { return Promise.resolve(ben ? ben.uid : null); },
    isOwner: function () { return Promise.resolve(rol === 'gelistirici'); },
    canEdit: function () { return Promise.resolve(rol === 'gelistirici'); },
    can: function (n) { return Promise.resolve(n === 'data.write' ? !!ben : null); },
    me: function () { return Promise.resolve(kisi(ben ? ben.uid : '', ad)); },
    name: function () { return Promise.resolve(ad); },
    profiles: function (ids) {
      ids = (ids || []).filter(function (x) { return typeof x === 'string' && x; });
      return Promise.all(ids.map(profilOku)).then(function (adlar) { var o = {}; ids.forEach(function (id, i) { o[id] = kisi(id, adlar[i]); }); return o; });
    },
    search: function (q) {
      q = String(q || '').toLocaleLowerCase('tr-TR');
      return fs.collection('profil').limit(1000).get().then(function (s) {
        return s.docs.map(function (d) { var a = String((d.data() || {}).ad || ''); prof[d.id] = { ad: a, t: Date.now() }; return kisi(d.id, a); })
          .filter(function (p) { return !q || p.name.toLocaleLowerCase('tr-TR').indexOf(q) >= 0; });
      }, function () { return []; });
    }
  });

  window.claude = Object.freeze({ use: function (n) { return oturum.then(function () { return n === 'db' ? dbApi : n === 'user' ? userApi : null; }); } });
  window.__FB = {
    kullanici: function () { return ben ? { id: ben.uid, ad: ad, eposta: ben.email || '' } : null; },
    rol: function () { return rol; },
    cikis: function () { cikiliyor = true; return auth.signOut().then(function () { location.reload(); }, function () { cikiliyor = false; }); }
  };

  /* Giriş ekranı */
  function el(id) { return document.getElementById(id); }
  var mod = 'giris';
  function ekran() {
    var g = el('giris'); if (!g || g.__bagli) return g;
    g.__bagli = true;
    var form = el('gr-form'), btn = el('gr-btn'), msj = el('gr-mesaj'), adK = el('gr-ad-k'), sifre = el('gr-sifre'), unut = el('gr-unuttum');
    function mesaj(t, ok) { msj.textContent = t || ''; msj.hidden = !t; msj.classList.toggle('ok', !!ok); }
    function modSec(m) {
      mod = m;
      Array.prototype.forEach.call(g.querySelectorAll('[data-mod]'), function (b) { var on = b.getAttribute('data-mod') === m; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      adK.hidden = m !== 'kayit'; unut.hidden = m !== 'giris';
      btn.textContent = m === 'kayit' ? 'Hesap oluştur' : 'Giriş yap';
      sifre.setAttribute('autocomplete', m === 'kayit' ? 'new-password' : 'current-password');
      el('gr-alt').textContent = m === 'kayit' ? 'Yeni bir hesap oluştur.' : 'Devam etmek için giriş yap.';
      mesaj('');
    }
    g.querySelector('.gr-sekme').addEventListener('click', function (e) { var b = e.target.closest('[data-mod]'); if (b) modSec(b.getAttribute('data-mod')); });
    function turkce(e) {
      var c = (e && e.code) || '';
      if (c === 'auth/invalid-email') return 'E-posta adresi geçersiz.';
      if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') return 'E-posta ya da şifre hatalı.';
      if (c === 'auth/email-already-in-use') return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.';
      if (c === 'auth/weak-password') return 'Şifre en az 6 karakter olmalı.';
      if (c === 'auth/too-many-requests') return 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.';
      if (c === 'auth/network-request-failed') return 'İnternet bağlantısı yok gibi görünüyor.';
      if (c === 'auth/missing-password') return 'Şifreni yaz.';
      return 'Bir sorun oluştu. Tekrar dene.';
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ep = el('gr-eposta').value.trim(), sf = sifre.value, a = el('gr-ad').value.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (mod === 'kayit' && a.length < 2) { mesaj('Adını ve soyadını yaz.'); el('gr-ad').focus(); return; }
      if (!ep) { mesaj('E-posta adresini yaz.'); el('gr-eposta').focus(); return; }
      if (sf.length < 6) { mesaj('Şifre en az 6 karakter olmalı.'); sifre.focus(); return; }
      btn.disabled = true; mesaj('');
      var is = mod === 'kayit'
        ? (bekleyenAd = a, auth.createUserWithEmailAndPassword(ep, sf).then(function (c) { return c.user.updateProfile({ displayName: a }).catch(function () {}); }))
        : auth.signInWithEmailAndPassword(ep, sf);
      is.then(function () { btn.disabled = false; }, function (er) { btn.disabled = false; bekleyenAd = ''; mesaj(turkce(er)); });
    });
    unut.addEventListener('click', function () {
      var ep = el('gr-eposta').value.trim();
      if (!ep) { mesaj('Önce e-posta adresini yaz.'); el('gr-eposta').focus(); return; }
      unut.disabled = true;
      auth.sendPasswordResetEmail(ep).then(function () { unut.disabled = false; mesaj('Şifre sıfırlama bağlantısı e-postana gönderildi.', true); },
        function (er) { unut.disabled = false; mesaj(er && er.code === 'auth/user-not-found' ? 'Bu e-posta ile kayıtlı hesap yok.' : turkce(er)); });
    });
    modSec('giris');
    return g;
  }
  function girisGoster() {
    var g = ekran(); if (!g) return;
    g.hidden = false; document.documentElement.classList.add('giris-acik');
    setTimeout(function () { var i = el('gr-eposta'); if (i && !g.hidden) try { i.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  function girisGizle() { var g = el('giris'); if (g) g.hidden = true; document.documentElement.classList.remove('giris-acik'); }

  var ilk = true;
  auth.onAuthStateChanged(function (u) {
    if (!u) {
      if (!ilk && ben) { if (!cikiliyor) location.reload(); return; }
      ben = null; ilk = false;
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', girisGoster); else girisGoster();
      return;
    }
    if (ben && ben.uid !== u.uid) { location.reload(); return; }
    ilk = false; ben = u;
    Promise.all([
      fs.doc('roller/' + u.uid).get().catch(function () { return null; }),
      fs.doc('profil/' + u.uid).get().catch(function () { return null; })
    ]).then(function (r) {
      var rd = r[0] && r[0].exists ? r[0].data() || {} : {};
      rol = ROLLER[rd.rol] ? rd.rol : 'standart';
      var pd = r[1] && r[1].exists ? r[1].data() || {} : null;
      ad = (pd && typeof pd.ad === 'string' && pd.ad) || bekleyenAd || u.displayName || '';
      if (ad && (!pd || pd.ad !== ad)) fs.doc('profil/' + u.uid).set({ ad: ad.slice(0, 60), t: Date.now() }).catch(function () {});
      prof[u.uid] = { ad: ad, t: Date.now() };
      bekleyenAd = '';
      girisGizle();
      oturumAc();
      try { window.dispatchEvent(new Event('fb-oturum')); } catch (e) {}
    });
  });
})();
