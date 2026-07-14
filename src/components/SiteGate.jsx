import { useMemo, useState } from 'react';
import { getApiBase } from '../lib/api-client';
import { INVITE_CODES, isValidInviteCode, storeAccessSession } from '../lib/access-control';
import { isSiteGateUnlocked, unlockSiteGate, unlockSiteGateFromUrl, SITE_GATE_KEY } from '../lib/site-gate';
import BrandLogo from './BrandLogo';
import './SiteGate.css';

const ACCESS_MODES = [
  { id: 'signup', label: 'Create User' },
  { id: 'login', label: 'Log In' },
  { id: 'ceo', label: 'CEO' },
  { id: 'invite', label: 'Guest Code' },
  { id: 'spy', label: 'Spy' },
];

function initialUnlockedState() {
  return unlockSiteGateFromUrl() || isSiteGateUnlocked();
}

async function accessRequest(path, body) {
  const response = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-slt-site-gate': SITE_GATE_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export default function SiteGate({ children }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(initialUnlockedState);

  const modeTitle = useMemo(() => {
    if (mode === 'signup') return 'Create your studio user';
    if (mode === 'login') return 'Log in to your studio';
    if (mode === 'ceo') return 'CEO access';
    if (mode === 'invite') return 'Guest production pass';
    return 'Spy mode';
  }, [mode]);

  const enterStudio = ({ session, user }) => {
    unlockSiteGate(SITE_GATE_KEY);
    storeAccessSession({ session, user });
    setUnlocked(true);
    setError('');
  };

  const handleSignup = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    setError('');
    const signup = await accessRequest('/api/auth/signup', {
      email: email.trim(),
      password,
      username: username.trim() || email.split('@')[0],
    });
    if (!signup.ok) {
      setError(signup.data?.readableError || signup.data?.error || 'Could not create user.');
      setBusy(false);
      return;
    }
    const login = await accessRequest('/api/login', { email: email.trim(), password });
    setBusy(false);
    if (!login.ok || !login.data?.session) {
      setError(login.data?.readableError || 'User created. Log in with your password.');
      setMode('login');
      return;
    }
    enterStudio({ session: login.data.session, user: login.data.user || login.data.session });
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await accessRequest('/api/login', { email: email.trim(), password });
    setBusy(false);
    if (!result.ok || !result.data?.session) {
      setError(result.data?.readableError || result.data?.error || 'Invalid login.');
      return;
    }
    enterStudio({ session: result.data.session, user: result.data.user || result.data.session });
  };

  const handleCeo = async () => {
    if (!password.trim()) {
      setError('CEO key is required.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await accessRequest('/api/login', { username: 'ceo', password });
    setBusy(false);
    if (!result.ok || !result.data?.session) {
      setError(result.data?.readableError || result.data?.error || 'Invalid CEO key.');
      return;
    }
    enterStudio({ session: result.data.session, user: result.data.user || result.data.session });
  };

  const handleInvite = async () => {
    if (!isValidInviteCode(inviteCode)) {
      setError('Guest code is not valid.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await accessRequest('/api/login', { inviteCode });
    setBusy(false);
    if (!result.ok || !result.data?.session) {
      setError(result.data?.readableError || result.data?.error || 'Guest code could not start.');
      return;
    }
    enterStudio({ session: result.data.session, user: result.data.user || result.data.session });
  };

  const handleSpy = () => {
    const now = new Date().toISOString();
    const session = {
      id: 'spy-visitor',
      role: 'SPY',
      mode: 'SPY_READ_ONLY',
      username: 'Spy visitor',
      createdAt: now,
    };
    const user = {
      id: 'spy-visitor',
      role: 'SPY',
      mode: 'SPY_READ_ONLY',
      username: 'Spy visitor',
    };
    enterStudio({ session, user });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'signup') handleSignup();
    else if (mode === 'login') handleLogin();
    else if (mode === 'ceo') handleCeo();
    else if (mode === 'invite') handleInvite();
    else handleSpy();
  };

  if (unlocked) return children;

  return (
    <section className="site-gate">
      <div className="site-gate-aurora site-gate-aurora--one" aria-hidden="true" />
      <div className="site-gate-aurora site-gate-aurora--two" aria-hidden="true" />
      <div className="site-gate-aurora site-gate-aurora--three" aria-hidden="true" />

      <div className="site-gate-panel page-rise">
        <BrandLogo className="site-gate-logo" variant="hero" />
        <p className="site-gate-kicker">Private production access</p>
        <h1>{modeTitle}</h1>
        <p className="site-gate-copy">
          Choose how you want to enter Sweet Little Trauma Studio.
        </p>

        <div className="site-gate-tabs" role="tablist" aria-label="Access mode">
          {ACCESS_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={mode === item.id ? 'is-active' : ''}
              onClick={() => {
                setMode(item.id);
                setError('');
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' ? (
            <>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Studio name" autoComplete="name" />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="new-password" />
            </>
          ) : null}

          {mode === 'login' ? (
            <>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" autoFocus />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password" />
            </>
          ) : null}

          {mode === 'ceo' ? (
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="CEO private key" autoComplete="current-password" autoFocus />
          ) : null}

          {mode === 'invite' ? (
            <>
              <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Guest code" autoComplete="one-time-code" autoFocus />
              <p className="site-gate-note">
                Guest mode allows 2 videos, 2 images, 2 sound FX, 2 songs, 2 fashion requests and 2 engineering requests.
              </p>
            </>
          ) : null}

          {mode === 'spy' ? (
            <p className="site-gate-note">
              Spy mode only lets you navigate and inspect the site. It cannot create, generate, upload or spend credits.
            </p>
          ) : null}

          <button type="submit" disabled={busy}>
            {busy ? 'Opening...' : mode === 'spy' ? 'Enter Spy Mode' : 'Enter Studio'}
          </button>
        </form>
        {mode === 'invite' ? <p className="site-gate-codes">Valid guest passes: {INVITE_CODES.join(' / ')}</p> : null}
        {error ? <p className="site-gate-error">{error}</p> : null}
      </div>
    </section>
  );
}
