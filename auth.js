import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

const signOutButton = document.getElementById('signOutBtn');
const status = document.getElementById('authStatus');
const authForm = document.getElementById('authForm');
const signInTab = document.getElementById('signInTab');
const createAccountTab = document.getElementById('createAccountTab');
const usernameField = document.getElementById('usernameField');
const usernameInput = document.getElementById('usernameInput');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const confirmPasswordField = document.getElementById('confirmPasswordField');
const confirmPasswordInput = document.getElementById('confirmPasswordInput');
const submitButton = document.getElementById('authSubmit');
const resetPasswordButton = document.getElementById('resetPassword');
const authCopy = document.getElementById('authCopy');
let auth;
let isCreatingAccount = false;

function showStatus(message, isError = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('is-error', isError);
}

function setFormEnabled(enabled) {
  signInTab.disabled = !enabled;
  createAccountTab.disabled = !enabled;
  submitButton.disabled = !enabled;
}

function friendlyError(error) {
  if (error.code === 'auth/email-already-in-use') return 'An account already exists for this email. Sign in instead.';
  if (error.code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (error.code === 'auth/weak-password') return 'Choose a password with at least 6 characters.';
  if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') return 'Email or password is incorrect.';
  if (error.code === 'auth/too-many-requests') return 'Too many attempts. Wait a little while, then try again.';
  if (error.code === 'auth/network-request-failed') return 'Could not connect. Check your internet connection and try again.';
  if (error.code === 'auth/unauthorized-domain') return 'This website domain is not authorized in Firebase Authentication settings.';
  if (error.code === 'auth/operation-not-allowed') return 'Enable Email/Password sign-in in the Firebase console, then try again.';
  return error.message || 'Sign-in failed. Please try again.';
}

function setMode(createAccount) {
  isCreatingAccount = createAccount;
  signInTab.setAttribute('aria-selected', String(!createAccount));
  createAccountTab.setAttribute('aria-selected', String(createAccount));
  usernameField.hidden = !createAccount;
  confirmPasswordField.hidden = !createAccount;
  confirmPasswordInput.required = createAccount;
  passwordInput.autocomplete = createAccount ? 'new-password' : 'current-password';
  submitButton.textContent = createAccount ? 'Create account' : 'Sign in';
  resetPasswordButton.hidden = createAccount;
  authCopy.textContent = createAccount
    ? 'Create an account with your email and a password to get started.'
    : 'Sign in with your email and password to continue.';
  showStatus('');
}

signInTab.addEventListener('click', () => setMode(false));
createAccountTab.addEventListener('click', () => setMode(true));

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!auth || !authForm.reportValidity()) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const username = usernameInput.value.trim();
  if (isCreatingAccount && password !== confirmPasswordInput.value) {
    showStatus('Passwords do not match.', true);
    confirmPasswordInput.focus();
    return;
  }

  submitButton.disabled = true;
  signInTab.disabled = true;
  createAccountTab.disabled = true;
  showStatus(isCreatingAccount ? 'Creating your account securely…' : 'Signing in securely…');
  try {
    if (isCreatingAccount) {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (username) await updateProfile(credential.user, { displayName: username });
      document.getElementById('accountLabel').textContent = username || credential.user.email || '';
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    showStatus(friendlyError(error), true);
  } finally {
    setFormEnabled(true);
  }
});

resetPasswordButton.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showStatus('Enter your email address first, then choose “Forgot password?” again.', true);
    emailInput.focus();
    return;
  }

  resetPasswordButton.disabled = true;
  showStatus('Sending password reset email…');
  try {
    await sendPasswordResetEmail(auth, email);
    showStatus('If an account exists for that email, a password reset link has been sent.');
  } catch (error) {
    showStatus(friendlyError(error), true);
  } finally {
    resetPasswordButton.disabled = false;
  }
});

signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    await signOut(auth);
  } catch (error) {
    showStatus(`Could not sign out: ${friendlyError(error)}`, true);
  } finally {
    signOutButton.disabled = false;
  }
});

const configIsReady = ['apiKey', 'authDomain', 'projectId', 'appId']
  .every(key => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].trim());

if (location.protocol === 'file:') {
  setFormEnabled(false);
  showStatus('Sign-in cannot run from a file. Start a local server with “python -m http.server 8000”, then open http://localhost:8000 and make sure localhost is an authorized Firebase domain.', true);
} else if (!configIsReady) {
  setFormEnabled(false);
  showStatus('Sign-in is not configured. Check the Firebase web app settings in firebase-config.js.', true);
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
    setFormEnabled(true);
    showStatus('Sign in or create an account to continue.');

    onAuthStateChanged(auth, user => {
      document.body.classList.toggle('authenticated', Boolean(user));
      document.getElementById('accountLabel').textContent = user?.displayName || user?.email || '';
      window.dispatchEvent(new CustomEvent('cyberguard:auth', {
        detail: { uid: user?.uid || null }
      }));
      if (!user) showStatus('Sign in or create an account to continue.');
    }, error => {
      document.body.classList.remove('authenticated');
      showStatus(`Could not verify your sign-in: ${friendlyError(error)}`, true);
    });
  } catch (error) {
    setFormEnabled(false);
    showStatus(`Could not start secure sign-in: ${friendlyError(error)}`, true);
  }
}
