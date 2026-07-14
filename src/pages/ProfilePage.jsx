import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStudio } from '../context/StudioContext';
import { apiRequest, fetchCeoProviderCredits } from '../lib/api-client';
import './StudioLayout.css';

export default function ProfilePage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('ceo');
  const [password, setPassword] = useState('');
  const [loginMode, setLoginMode] = useState('standard');
  const [authProvider, setAuthProvider] = useState('local');
  const [signupEnabled, setSignupEnabled] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [creditsBusy, setCreditsBusy] = useState(false);
  const [providerCredits, setProviderCredits] = useState([]);
  const [creditsStatus, setCreditsStatus] = useState('');
  const [showLoginForm, setShowLoginForm] = useState(false);
  const { user, session, setUser, setSession, logout, isCEO, isAuthenticated } = useAuth();
  const { credits, refresh, refreshLedger } = useStudio();

  useEffect(() => {
    apiRequest('/health', { timeoutMs: 8000 }).then((result) => {
      if (!result.ok || !result.data) return;
      const provider = String(result.data.auth?.provider || 'local').toLowerCase();
      setAuthProvider(provider);
      setSignupEnabled(Boolean(result.data.auth?.signupEnabled));
    }).catch(() => null);
  }, []);

  useEffect(() => {
    if (isCEO) {
      setStatus('CEO mode active. Internal SLT credits are not charged.');
      setShowLoginForm(false);
    } else if (isAuthenticated) {
      setStatus(`Session active as ${session?.email || session?.username || 'user'}.`);
      setShowLoginForm(false);
    } else {
      setStatus('No active session.');
      setShowLoginForm(true);
    }
  }, [isCEO, isAuthenticated, session]);

  const refreshProviderCredits = useCallback(async () => {
    if (!isCEO) return;
    setCreditsBusy(true);
    setCreditsStatus('Refreshing provider credits...');
    const result = await fetchCeoProviderCredits();
    if (result.ok && Array.isArray(result.data.providers)) {
      setProviderCredits(result.data.providers);
      setCreditsStatus(`Updated ${new Date(result.data.checkedAt).toLocaleTimeString()}.`);
    } else {
      setCreditsStatus(result.message || result.data?.readableError || 'Could not refresh provider credits.');
    }
    setCreditsBusy(false);
  }, [isCEO]);

  useEffect(() => {
    refreshProviderCredits();
  }, [refreshProviderCredits]);

  const startSession = async (nextSession, nextUser) => {
    setSession(nextSession);
    setUser(nextUser);
    setPassword('');
    setShowLoginForm(false);
    await Promise.all([refresh(), refreshLedger().catch(() => null)]);
    setStatus(nextSession.role === 'CEO'
      ? 'CEO mode active. Internal SLT credits are not charged.'
      : `Session started. ${typeof credits === 'number' ? `${credits} credits available.` : ''}`);
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus(loginMode === 'ceo' ? 'Opening CEO mode...' : 'Starting session...');

    const body = loginMode === 'ceo'
      ? { username, password }
      : { email, password };

    const result = await apiRequest('/api/login', {
      method: 'POST',
      body,
      timeoutMs: 20000,
    });

    if (!result.ok || !result.data?.session) {
      setStatus(result.message || result.data?.readableError || 'Could not start session.');
      setBusy(false);
      return;
    }

    await startSession(result.data.session, result.data.user || result.data.session);
    setBusy(false);
  };

  const handleSignup = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setStatus('Email and password are required.');
      return;
    }
    setBusy(true);
    setStatus('Creating account...');
    const signup = await apiRequest('/api/auth/signup', {
      method: 'POST',
      body: { email, password, username: username.trim() || email.split('@')[0] },
      timeoutMs: 20000,
    });
    if (!signup.ok) {
      setStatus(signup.message || signup.data?.readableError || 'Could not create account.');
      setBusy(false);
      return;
    }
    setStatus('Account created. Signing in...');
    const login = await apiRequest('/api/login', {
      method: 'POST',
      body: { email, password },
      timeoutMs: 20000,
    });
    if (!login.ok || !login.data?.session) {
      setStatus(login.message || login.data?.readableError || 'Account created. Sign in with your password.');
      setLoginMode('standard');
      setBusy(false);
      return;
    }
    await startSession(login.data.session, login.data.user || login.data.session);
    setLoginMode('standard');
    setBusy(false);
  };

  const handleRecover = async (event) => {
    event.preventDefault();
    if (!email.trim()) {
      setStatus('Enter your email to receive a reset link.');
      return;
    }
    setBusy(true);
    setStatus('Sending recovery email...');
    const result = await apiRequest('/api/auth/password-recovery', {
      method: 'POST',
      body: { email },
      timeoutMs: 20000,
    });
    setStatus(result.ok
      ? (result.data?.message || 'Check your inbox for the reset link.')
      : (result.message || result.data?.readableError || 'Could not send recovery email.'));
    setBusy(false);
  };

  const handleLogout = () => {
    logout();
    setProviderCredits([]);
    setCreditsStatus('');
    setPassword('');
    setShowLoginForm(true);
    setLoginMode('standard');
    setStatus('Session closed.');
  };

  const isSupabase = authProvider === 'supabase';
  const showSignup = isSupabase && signupEnabled;
  const formMode = loginMode === 'signup' ? 'signup' : loginMode === 'recover' ? 'recover' : 'login';
  const formHandler = formMode === 'signup' ? handleSignup : formMode === 'recover' ? handleRecover : handleLogin;

  const formatBalance = (provider) => {
    if (provider.balance === null || provider.balance === undefined || provider.balance === '') return '—';
    return `${provider.balance} ${provider.unit || ''}`.trim();
  };

  return (
    <section className="profile-page">
      <div className="profile-panel">
        <p className="studio-rail-label">Profile</p>
        <h1 className="info-page-title">{isAuthenticated ? 'Account' : 'Sign in'}</h1>
        <p className="info-page-body">
          {isSupabase
            ? 'Create an account or sign in with your Supabase credentials. CEO mode still uses your private key.'
            : 'Standard login creates a local session with wallet credits. CEO mode uses your private key and skips internal billing.'}
        </p>

        <div className={`profile-status ${isCEO ? 'is-ceo' : ''} ${isAuthenticated ? 'is-connected' : ''}`}>
          <span>{isCEO ? 'CEO' : isAuthenticated ? 'Connected' : 'Guest'}</span>
          <p>{status || 'No active session.'}</p>
          {isAuthenticated && !isCEO && typeof credits === 'number' ? (
            <p className="studio-meta">{credits} credits available</p>
          ) : null}
          {isAuthenticated ? (
            <p className="studio-meta">
              {session?.email || session?.username || 'Signed in'}
            </p>
          ) : null}
        </div>

        {isAuthenticated && !showLoginForm ? (
          <div className="info-page-actions" style={{ marginBottom: '18px' }}>
            <button type="button" className="studio-action" onClick={handleLogout}>
              [ Log Out ]
            </button>
            <button type="button" className="studio-action" onClick={() => setShowLoginForm(true)}>
              [ Switch account ]
            </button>
          </div>
        ) : null}

        {showLoginForm || !isAuthenticated ? (
          <>
        <div className="video-chip-row" style={{ marginBottom: '18px' }}>
          <button
            type="button"
            className={`video-chip ${loginMode === 'standard' ? 'is-active' : ''}`}
            onClick={() => setLoginMode('standard')}
          >
            Sign in
          </button>
          {showSignup ? (
            <button
              type="button"
              className={`video-chip ${loginMode === 'signup' ? 'is-active' : ''}`}
              onClick={() => setLoginMode('signup')}
            >
              Create account
            </button>
          ) : null}
          {showSignup ? (
            <button
              type="button"
              className={`video-chip ${loginMode === 'recover' ? 'is-active' : ''}`}
              onClick={() => setLoginMode('recover')}
            >
              Forgot password
            </button>
          ) : null}
          <button
            type="button"
            className={`video-chip ${loginMode === 'ceo' ? 'is-active' : ''}`}
            onClick={() => setLoginMode('ceo')}
          >
            CEO
          </button>
        </div>

        <form className="profile-login" onSubmit={formHandler}>
          {loginMode === 'ceo' ? (
            <label>
              <span>Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="ceo"
              />
            </label>
          ) : (
            <label>
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
          )}
          {formMode !== 'recover' ? (
            <label>
              <span>{loginMode === 'ceo' ? 'Private key' : 'Password'}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={formMode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={loginMode === 'ceo' ? 'CEO key' : 'Your password'}
                required={loginMode !== 'ceo' && isSupabase}
              />
            </label>
          ) : null}
          {formMode === 'signup' ? (
            <label>
              <span>Display name (optional)</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="name"
                placeholder="Your name"
              />
            </label>
          ) : null}
          <button type="submit" className="video-primary-button" disabled={busy}>
            {busy
              ? 'Working...'
              : formMode === 'signup'
                ? 'Create account'
                : formMode === 'recover'
                  ? 'Send reset link'
                  : loginMode === 'ceo'
                    ? 'Enter CEO Mode'
                    : 'Start Session'}
          </button>
        </form>
          </>
        ) : null}

        {isCEO ? (
          <section className="provider-credits-panel">
            <div className="provider-credits-header">
              <div>
                <p className="studio-rail-label">Provider Credits</p>
                <h2>External balances.</h2>
              </div>
              <button
                type="button"
                className="studio-action"
                onClick={refreshProviderCredits}
                disabled={creditsBusy}
              >
                [ {creditsBusy ? 'Refreshing' : 'Refresh'} ]
              </button>
            </div>
            {creditsStatus ? <p className="studio-meta">{creditsStatus}</p> : null}
            <div className="provider-credits-table-wrap">
              <table className="studio-table provider-credits-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Type</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {providerCredits.length ? providerCredits.map((provider) => (
                    <tr key={`${provider.name}-${provider.kind}`}>
                      <td>{provider.name}</td>
                      <td>{provider.kind}</td>
                      <td>{formatBalance(provider)}</td>
                      <td>{provider.ok ? 'OK' : provider.status}</td>
                      <td>{provider.detail}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="5">Enter CEO mode to refresh provider credits.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <div className="info-page-actions">
          <Link to="/video" className="studio-action">[ Open Video Studio ]</Link>
          <Link to="/library" className="studio-action">[ Library ]</Link>
          <Link to="/ceo" className="studio-action">[ CEO Dashboard ]</Link>
          {isAuthenticated && showLoginForm ? (
            <button type="button" className="studio-action" onClick={() => setShowLoginForm(false)}>
              [ Back to account ]
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
