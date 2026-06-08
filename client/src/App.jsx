import { API_BASE_URL } from './config';
import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import io from 'socket.io-client';

import { auth, googleProvider } from './firebase.js';
import { RecaptchaVerifier, signInWithPhoneNumber, signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';

const TRANSLATION_LANGUAGES = [
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ta', name: 'Tamil' },
  { code: 'ur', name: 'Urdu' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'kn', name: 'Kannada' },
  { code: 'or', name: 'Odia' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ko', name: 'Korean' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
];

// Global toast notifier helper
let globalShowToast = () => {};

export default function App() {
  const [toast, setToast] = useState(null);

  const showToast = (title, message, type = 'normal') => {
    setToast({ title, message, type });
    setTimeout(() => {
      setToast(null);
    }, 6000);
  };

  useEffect(() => {
    globalShowToast = showToast;
    // Set root document language for keyboard/OS localization
    const savedLang = localStorage.getItem('settings_ui_lang') || 'en';
    document.documentElement.lang = savedLang;
  }, []);

  return (
    <BrowserRouter>
      <div className="glass-bg"></div>
      
      {/* Toast Alert Element */}
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type === 'otp' ? 'toast-otp' : ''}`}>
            <i className={`toast-icon ${toast.type === 'otp' ? 'fa-solid fa-key' : 'fa-solid fa-circle-info'}`}></i>
            <div className="toast-body">
              <span className="toast-title">{toast.title}</span>
              <span className="toast-msg" dangerouslySetInnerHTML={{ __html: toast.message }}></span>
            </div>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/" element={<Step1Login />} />
        <Route path="/verify" element={<Step2Verify />} />
        <Route path="/login-password" element={<Step2LoginPassword />} />
        <Route path="/verify-email" element={<Step2EmailVerify />} />
        <Route path="/password" element={<Step3Password />} />
        <Route path="/details" element={<Step4Details />} />
        <Route path="/photo" element={<Step5Photo />} />
        <Route path="/photo" element={<Step5Photo />} />
        <Route path="/language" element={<Step6Language />} />
        <Route path="/success" element={<Step6Success />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat/:contactId" element={<ChatDetail />} />
      </Routes>
    </BrowserRouter>
  );
}

// =================================================================
// STEP 1: index.html (Identifier/Password Mode)
// =================================================================
function Step1Login() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState(localStorage.getItem('onboarding_id') || '');
  const [password, setPassword] = useState('');
  const [isPasswordMode, setIsPasswordMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [userExists, setUserExists] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem('onboarding_id', identifier);
    if (identifier.trim().length > 3) {
      // Check if user exists on server
      fetch(API_BASE_URL + '/api/auth/check-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: identifier })
      })
      .then(res => res.json())
      .then(data => {
        setUserExists(data.exists);
      })
      .catch(err => console.error(err));
    } else {
      setUserExists(false);
      setIsPasswordMode(false);
    }
  }, [identifier]);

  // Recaptcha is initialized dynamically on submit to prevent React StrictMode DOM issues

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      localStorage.setItem('onboarding_id', user.uid); // Use Firebase UID!
      localStorage.setItem('onboarding_name', user.displayName || 'Explorer');
      localStorage.setItem('onboarding_photo', user.photoURL || '');
      localStorage.setItem('onboarding_is_new', 'true');
      localStorage.setItem('onboarding_skip_password', 'true');
      
      globalShowToast('Authentication', 'Google Sign-In Successful!', 'normal');
      
      // Auto-register in our DB then navigate
      fetch(API_BASE_URL + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: user.uid,
          name: user.displayName || 'Explorer',
          age: '25',
          password: 'google_oauth_user', // mock pwd for legacy db
          photo: user.photoURL || ''
        })
      }).then(() => {
        setTimeout(() => navigate('/success'), 800);
      });
      
    } catch (error) {
      console.error(error);
      globalShowToast('Google Auth', error.message, 'normal');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const idClean = identifier.trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(idClean);
    let isPhone = false;
    let formattedPhone = idClean;

    // Check if phone (allow with or without +)
    if (/^\+?\d{10,15}$/.test(idClean.replace(/[-\s]/g, ''))) {
      isPhone = true;
      formattedPhone = idClean.replace(/[-\s]/g, '');
      if (!formattedPhone.startsWith('+')) {
        // Default to +91 if no country code provided
        formattedPhone = '+91' + formattedPhone; 
      }
    }

    if (!isEmail && !isPhone) {
      globalShowToast('Validation Error', 'Please enter a valid email or 10+ digit mobile number.', 'normal');
      return;
    }

    // Bypass OTP Flow entirely per user request
    localStorage.setItem('onboarding_is_new', userExists ? 'false' : 'true');
    localStorage.setItem('onboarding_id', isPhone ? formattedPhone : idClean);
    localStorage.setItem('onboarding_skip_password', 'false');

    globalShowToast('Success', 'Proceeding...', 'normal');
    setTimeout(() => {
      if (userExists) {
        navigate('/login-password'); // Existing user, enter password
      } else {
        navigate('/password'); // New user, create password
      }
    }, 800);
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
    if (!identifier) {
      globalShowToast('Attention', 'Enter your identifier in Step 1 first.', 'normal');
      return;
    }
    localStorage.setItem('onboarding_is_new', 'false');
    localStorage.setItem('onboarding_is_reset', 'true');
    globalShowToast('Information', 'For password resets, contact support or use OTP.', 'normal');
  };

  return (
    <section class="auth-section">
      {/* Stepper Wizard Header */}
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator active">
          <div class="step-number">1</div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">2</div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">3</div>
          <div class="step-label">Password</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">4</div>
          <div class="step-label">Details</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">5</div>
          <div class="step-label">Avatar</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active">
          <div class="card-art">
            <div class="avatar-ring">
              <i class="fa-solid fa-shield-halved art-icon-main"></i>
            </div>
          </div>
          <h2 class="auth-title">Welcome to SmartChat</h2>
          <p class="auth-subtitle">Translate chats in real-time with your partner</p>

          <form onSubmit={handleSubmit}>
            <div class="input-group">
              <span class="field-label">Email or Mobile Number</span>
              <div class="input-wrapper">
                <i class="fa-solid fa-user input-icon"></i>
                <input
                  type="text"
                  placeholder="Enter email or mobile number"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div id="recaptcha-container"></div>

            <button type="submit" class="btn-primary" disabled={isLoading}>
              <span>{isLoading ? 'Processing...' : 'Continue'}</span>
              {!isLoading && <i class="fa-solid fa-arrow-right"></i>}
            </button>
          </form>

          <div class="divider">OR</div>

          <div class="social-login">
            <span class="social-text">Sign in instantly with</span>
            <div class="social-buttons">
              <button class="btn-social" onClick={handleGoogleSignIn} disabled={isLoading} type="button">
                <i class="fa-brands fa-google" style={{ color: '#ea4335' }}></i>
                <span>Google Account</span>
              </button>
            </div>
          </div>

          <div class="auth-footer">
            <span>By proceeding, you agree to our </span>
            <a href="#">Terms</a>
            <span> & </span>
            <a href="#">Privacy Policy</a>
          </div>
        </div>
      </div>
    </section>
  );
}

// =================================================================
// STEP 2: verify.html (Verify OTP)
// =================================================================
function Step2Verify() {
  const navigate = useNavigate();
  const digitsRef = useRef([]);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [timeLeft, setTimeLeft] = useState(30);

  const identifier = localStorage.getItem('onboarding_id') || '';

  useEffect(() => {
    const isEmailOtp = localStorage.getItem('onboarding_is_email_otp') === 'true';
    if (!identifier || (!window.confirmationResult && !isEmailOtp)) {
      // If no active phone auth session and no email auth session, redirect to start
      navigate('/');
    }
  }, [identifier, navigate]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  const handleDigitChange = (val, idx) => {
    if (!val.match(/^[0-9]?$/)) return;
    const newDigits = [...digits];
    newDigits[idx] = val;
    setDigits(newDigits);

    if (val && idx < 5) {
      digitsRef.current[idx + 1].focus();
    }
  };

  const handleKeyDown = (e, idx) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      digitsRef.current[idx - 1].focus();
      const newDigits = [...digits];
      newDigits[idx - 1] = '';
      setDigits(newDigits);
    }
  };

  const handleResend = async (e) => {
    e.preventDefault();
    if (timeLeft > 0) return;

    const isEmailOtp = localStorage.getItem('onboarding_is_email_otp') === 'true';

    try {
      if (isEmailOtp) {
        const res = await fetch(API_BASE_URL + '/api/auth/send-email-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        globalShowToast('OTP Sent', `Code resent to ${identifier}`, 'otp');
      } else {
        const confirmationResult = await signInWithPhoneNumber(auth, identifier, window.recaptchaVerifier);
        window.confirmationResult = confirmationResult;
        globalShowToast('OTP Sent', `Code resent to ${identifier}`, 'otp');
      }
      setTimeLeft(30);
      setDigits(['', '', '', '', '', '']);
    } catch(err) {
      console.error(err);
      globalShowToast('Error', 'Failed to resend code.', 'normal');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const entered = digits.join('');
    if (entered.length !== 6) return;

    const isEmailOtp = localStorage.getItem('onboarding_is_email_otp') === 'true';

    if (isEmailOtp) {
      try {
        const res = await fetch(API_BASE_URL + '/api/auth/verify-email-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier, code: entered })
        });
        const data = await res.json();
        
        if (data.success) {
          globalShowToast('OTP Verified', 'Email verified successfully!', 'normal');
          
          setTimeout(() => {
            if (data.isNewUser) {
              navigate('/password'); // Force password creation
            } else {
              navigate('/login-password'); // Force password entry
            }
          }, 800);
        } else {
          globalShowToast('Verification Failed', data.error || 'Incorrect OTP.', 'normal');
        }
      } catch (err) {
        console.error(err);
        globalShowToast('Verification Failed', 'Network error. Try again.', 'normal');
      }
    } else {
      // Phone Auth Logic
      try {
        const result = await window.confirmationResult.confirm(entered);
        const user = result.user;
        
        globalShowToast('OTP Verified', 'Verification code confirmed.', 'normal');
        const isNew = localStorage.getItem('onboarding_is_new') === 'true';
        
        localStorage.setItem('onboarding_id', user.uid);

        setTimeout(() => {
          if (isNew) {
            navigate('/password'); // Force password creation
          } else {
            navigate('/login-password'); // Force password entry
          }
        }, 800);
      } catch (error) {
         console.error(error);
         globalShowToast('Verification Failed', 'Incorrect OTP. Try again.', 'normal');
      }
    }
  };

  return (
    <section class="auth-section">
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator active">
          <div class="step-number">2</div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">3</div>
          <div class="step-label">Password</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">4</div>
          <div class="step-label">Details</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">5</div>
          <div class="step-label">Avatar</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active">
          <button class="btn-back" onClick={() => navigate('/')}><i class="fa-solid fa-arrow-left"></i></button>
          
          <div class="card-art">
            <div class="avatar-ring">
              <i class="fa-solid fa-key art-icon-main"></i>
            </div>
          </div>
          
          <h2 class="auth-title">Verify OTP Code</h2>
          <p class="auth-subtitle">Enter the 6-digit confirmation code</p>

          <div class="identifier-display-row">
            <span>Sent to </span>
            <span id="target-identifier">{identifier}</span>
            <a href="#" class="change-link" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Change</a>
          </div>

          <form onSubmit={handleSubmit}>
            <div class="otp-inputs-row">
              {digits.map((digit, idx) => (
                <input
                  key={idx}
                  type="text"
                  maxLength={1}
                  class="otp-digit"
                  ref={el => digitsRef.current[idx] = el}
                  value={digit}
                  onChange={(e) => handleDigitChange(e.target.value, idx)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                  required
                />
              ))}
            </div>

            <div class="resend-container">
              <span>Didn't receive code? </span>
              <a
                href="#"
                className={`resend-link ${timeLeft > 0 ? 'disabled' : ''}`}
                onClick={handleResend}
              >
                Resend OTP
              </a>
              {timeLeft > 0 && (
                <span id="otp-timer">in 00:{timeLeft < 10 ? '0' : ''}{timeLeft}</span>
              )}
            </div>

            <button type="submit" class="btn-primary">
              <i class="fa-solid fa-circle-check"></i>
              <span>Verify Code</span>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

// =================================================================
// STEP 2.5: verify-email (Verify Email Link)
// =================================================================
function Step2EmailVerify() {
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState('');
  
  useEffect(() => {
    const confirmEmailLink = async () => {
      if (isSignInWithEmailLink(auth, window.location.href)) {
        let email = localStorage.getItem('onboarding_email_for_sign_in');
        if (!email) {
          // If opened on a different device, we'd normally prompt for email here.
          // For simplicity, we just reject if we don't have it locally.
          setErrorMsg('Please open the link on the same device where you started.');
          return;
        }

        try {
          const result = await signInWithEmailLink(auth, email, window.location.href);
          
          window.localStorage.removeItem('onboarding_email_for_sign_in');
          localStorage.setItem('onboarding_id', result.user.uid);
          
          globalShowToast('Email Verified', 'Successfully authenticated!', 'normal');
          
          const isNew = localStorage.getItem('onboarding_is_new') === 'true';
          const isReset = localStorage.getItem('onboarding_is_reset') === 'true';

          setTimeout(() => {
            if (isNew || isReset) {
              navigate('/details'); // Skip password entirely for link auth
            } else {
              // Direct login fallback
              fetch(API_BASE_URL + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: result.user.uid, password: 'email_link_user' })
              })
              .then(res => {
                if(!res.ok) throw new Error();
                return res.json();
              })
              .then(data => {
                localStorage.setItem('onboarding_name', data.user.name || 'Explorer');
                localStorage.setItem('onboarding_age', data.user.age || '25');
                localStorage.setItem('onboarding_photo', data.user.photo || '');
                if (data.user && data.user.language) {
                  localStorage.setItem('settings_chat_lang', data.user.language);
                }
                navigate('/success');
              })
              .catch(() => {
                 navigate('/details');
              });
            }
          }, 800);
          
        } catch (error) {
          setErrorMsg(error.message);
          globalShowToast('Verification Error', error.message, 'normal');
        }
      } else {
        navigate('/');
      }
    };
    
    confirmEmailLink();
  }, [navigate]);

  return (
    <section class="auth-section">
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator active">
          <div class="step-number">2</div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">3</div>
          <div class="step-label">Password</div>
        </div>
      </div>
      <div class="auth-cards-container">
        <div class="auth-card active" style={{textAlign: 'center'}}>
           <h2 class="auth-title">Verifying Email...</h2>
           {errorMsg ? (
             <p style={{color: '#ff4d4d', marginTop: '1rem'}}>{errorMsg}</p>
           ) : (
             <p>Please wait while we log you in...</p>
           )}
        </div>
      </div>
    </section>
  );
}

// =================================================================
// STEP 2.5: login-password (Login Password Entry)
// =================================================================
function Step2LoginPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const identifier = localStorage.getItem('onboarding_id') || '';

  useEffect(() => {
    if (!identifier) {
      navigate('/');
    }
  }, [identifier, navigate]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsLoading(true);

    fetch(API_BASE_URL + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: identifier, password })
    })
    .then(res => {
      if (!res.ok) throw new Error("Incorrect Password");
      return res.json();
    })
    .then(data => {
      localStorage.setItem('onboarding_name', data.user.name || 'Explorer');
      localStorage.setItem('onboarding_age', data.user.age || '25');
      localStorage.setItem('onboarding_photo', data.user.photo || '');
      if (data.user && data.user.language) {
        localStorage.setItem('settings_chat_lang', data.user.language);
      }
      globalShowToast('Authentication', 'Login Successful!', 'normal');
      setTimeout(() => navigate('/success'), 800);
    })
    .catch(err => {
      globalShowToast('Login Failure', err.message, 'normal');
    })
    .finally(() => {
      setIsLoading(false);
    });
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
    localStorage.setItem('onboarding_is_reset', 'true');
    globalShowToast('Reset Mode', 'Set a new password', 'normal');
    navigate('/password');
  };

  return (
    <section class="auth-section">
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator active">
          <div class="step-number">3</div>
          <div class="step-label">Password</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active">
          <button class="btn-back" onClick={() => navigate('/verify')}><i class="fa-solid fa-arrow-left"></i></button>
          
          <div class="card-art">
            <div class="avatar-ring">
              <i class="fa-solid fa-lock art-icon-main"></i>
            </div>
          </div>
          
          <h2 class="auth-title">Enter Password</h2>
          <p class="auth-subtitle">Welcome back! Please enter your password to continue.</p>

          <form onSubmit={handleSubmit}>
            <div class="input-group">
              <div class="label-row">
                <span class="field-label">Password</span>
                <a href="#" class="forgot-pass-link" onClick={handleForgotPassword}>Forgot password?</a>
              </div>
              <div class="input-wrapper">
                <i class="fa-solid fa-lock input-icon"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <i
                  className={`fa-regular ${showPassword ? 'fa-eye' : 'fa-eye-slash'} eye-toggle`}
                  onClick={() => setShowPassword(!showPassword)}
                ></i>
              </div>
            </div>

            <button type="submit" class="btn-primary" disabled={isLoading}>
              <span>{isLoading ? 'Logging in...' : 'Log In'}</span>
              {!isLoading && <i class="fa-solid fa-arrow-right"></i>}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

// =================================================================
// STEP 3: password.html (Set Password)
// =================================================================
function Step3Password() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const identifier = localStorage.getItem('onboarding_id');
  useEffect(() => {
    if (!identifier) navigate('/');
  }, [identifier]);

  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
  };

  const handleNext = (e) => {
    e.preventDefault();
    if (!Object.values(checks).every(Boolean)) {
      globalShowToast('Password Error', 'Password does not satisfy guidelines.', 'normal');
      return;
    }
    if (password !== confirmPassword) {
      globalShowToast('Match Error', 'Passwords do not match.', 'normal');
      return;
    }

    localStorage.setItem('onboarding_password', password);
    globalShowToast('Success', 'Password configured.', 'normal');

    const isReset = localStorage.getItem('onboarding_is_reset') === 'true';
    if (isReset) {
      // Save details to DB directly
      const name = localStorage.getItem('onboarding_name') || 'Explorer';
      const age = localStorage.getItem('onboarding_age') || '25';
      const photo = localStorage.getItem('onboarding_photo') || '';

      fetch(API_BASE_URL + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: identifier, password, name, age, photo })
      })
      .then(() => navigate('/success'))
      .catch(() => navigate('/success'));
    } else {
      navigate('/details');
    }
  };

  return (
    <section class="auth-section">
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator active">
          <div class="step-number">3</div>
          <div class="step-label">Password</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">4</div>
          <div class="step-label">Details</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">5</div>
          <div class="step-label">Avatar</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active">
          <button class="btn-back" onClick={() => navigate('/verify')}><i class="fa-solid fa-arrow-left"></i></button>

          <div class="card-art">
            <div class="avatar-ring">
              <i class="fa-solid fa-lock-open art-icon-main"></i>
            </div>
          </div>

          <h2 class="auth-title">Set Password</h2>
          <p class="auth-subtitle">Secure your Smart Messenger profile</p>

          <form onSubmit={handleNext}>
            <div class="input-group">
              <span class="field-label">New Password</span>
              <div class="input-wrapper">
                <i class="fa-solid fa-lock input-icon"></i>
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="Create password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <i
                  className={`fa-regular ${showPass ? 'fa-eye' : 'fa-eye-slash'} eye-toggle`}
                  onClick={() => setShowPass(!showPass)}
                ></i>
              </div>
            </div>

            <div class="input-group" style={{ marginBottom: '1.5rem' }}>
              <span class="field-label">Confirm Password</span>
              <div class="input-wrapper">
                <i class="fa-solid fa-circle-check input-icon"></i>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <i
                  className={`fa-regular ${showConfirm ? 'fa-eye' : 'fa-eye-slash'} eye-toggle`}
                  onClick={() => setShowConfirm(!showConfirm)}
                ></i>
              </div>
            </div>

            <div class="checklist-card">
              <span class="checklist-title">Password must contain:</span>
              <ul class="checklist-list">
                <li id="req-length" class={checks.length ? 'valid' : 'invalid'}>
                  <i className={`fa-solid ${checks.length ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                  <span>At least 8 characters long</span>
                </li>
                <li id="req-upper" class={checks.upper ? 'valid' : 'invalid'}>
                  <i className={`fa-solid ${checks.upper ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                  <span>One uppercase letter (A-Z)</span>
                </li>
                <li id="req-number" class={checks.number ? 'valid' : 'invalid'}>
                  <i className={`fa-solid ${checks.number ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                  <span>One number (0-9)</span>
                </li>
                <li id="req-special" class={checks.special ? 'valid' : 'invalid'}>
                  <i className={`fa-solid ${checks.special ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                  <span>One special character (!@#$)</span>
                </li>
              </ul>
            </div>

            <button type="submit" class="btn-primary">
              <span>Continue Setup</span>
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

// =================================================================
// STEP 4: details.html (Your Details)
// =================================================================
function Step4Details() {
  const navigate = useNavigate();
  const [name, setName] = useState(localStorage.getItem('onboarding_name') || '');
  const [age, setAge] = useState(localStorage.getItem('onboarding_age') || '');

  const identifier = localStorage.getItem('onboarding_id');
  useEffect(() => {
    if (!identifier) navigate('/');
  }, [identifier]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      globalShowToast('Validation Error', 'Enter a valid name (2+ characters).', 'normal');
      return;
    }
    const ageVal = parseInt(age);
    if (isNaN(ageVal) || ageVal < 1 || ageVal > 120) {
      globalShowToast('Validation Error', 'Please enter a valid age (1-120).', 'normal');
      return;
    }

    localStorage.setItem('onboarding_name', name.trim());
    localStorage.setItem('onboarding_age', age.trim());

    globalShowToast('Success', 'Profile details registered.', 'normal');
    setTimeout(() => navigate('/photo'), 800);
  };

  return (
    <section class="auth-section">
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Password</div>
        </div>
        <div class="step-indicator active">
          <div class="step-number">4</div>
          <div class="step-label">Details</div>
        </div>
        <div class="step-indicator">
          <div class="step-number">5</div>
          <div class="step-label">Avatar</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active">
          <button class="btn-back" onClick={() => navigate('/password')}><i class="fa-solid fa-arrow-left"></i></button>

          <div class="card-art">
            <div class="avatar-ring">
              <i class="fa-solid fa-circle-info art-icon-main"></i>
            </div>
          </div>

          <h2 class="auth-title">Your Details</h2>
          <p class="auth-subtitle">Add your name and age to continue</p>

          <form onSubmit={handleSubmit}>
            <div class="input-group">
              <span class="field-label">Full Name</span>
              <div class="input-wrapper">
                <i class="fa-solid fa-signature input-icon"></i>
                <input
                  type="text"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div class="input-group" style={{ marginBottom: '2rem' }}>
              <span class="field-label">Age</span>
              <div class="input-wrapper">
                <i class="fa-solid fa-calendar input-icon"></i>
                <input
                  type="number"
                  placeholder="Enter your age"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  required
                />
              </div>
            </div>

            <button type="submit" class="btn-primary">
              <span>Continue</span>
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

// =================================================================
// STEP 5: photo.html (Profile Photo - Gallery / Webcam)
// =================================================================
function Step5Photo() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [photo, setPhoto] = useState(localStorage.getItem('onboarding_photo') || '');
  const [showWebcam, setShowWebcam] = useState(false);
  const [stream, setStream] = useState(null);
  const [flash, setFlash] = useState(false);

  const identifier = localStorage.getItem('onboarding_id');
  useEffect(() => {
    if (!identifier) navigate('/');
  }, [identifier]);

  // Gallery Select
  const handleGallerySelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        globalShowToast('File Too Large', 'Image must be less than 5MB.', 'normal');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        const url = evt.target.result;
        setPhoto(url);
        localStorage.setItem('onboarding_photo', url);
        globalShowToast('Photo Loaded', 'Profile photo updated.', 'normal');
      };
      reader.readAsDataURL(file);
    }
  };

  // Launch Webcam stream
  const startCamera = async () => {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 400, facingMode: 'user' },
        audio: false
      });
      setStream(videoStream);
      setShowWebcam(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = videoStream;
        }
      }, 200);
    } catch (err) {
      console.error(err);
      globalShowToast('Camera Access Error', 'Webcam could not be opened. Check permissions.', 'normal');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setShowWebcam(false);
  };

  // Capture Canvas snapshots
  const captureSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    // Shutter flash animation
    setFlash(true);
    setTimeout(() => setFlash(false), 400);

    const ctx = canvasRef.current.getContext('2d');
    
    // Mirror image crop draw
    ctx.translate(400, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, 0, 0, 400, 400);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const dataUrl = canvasRef.current.toDataURL('image/jpeg');
    setPhoto(dataUrl);
    localStorage.setItem('onboarding_photo', dataUrl);

    stopCamera();
    globalShowToast('Snapshot Captured', 'Profile photo set successfully.', 'normal');
  };

  const completeSetup = (customPhoto = photo) => {
    const name = localStorage.getItem('onboarding_name') || 'Explorer';
    const age = localStorage.getItem('onboarding_age') || '25';
    const password = localStorage.getItem('onboarding_password') || '';

    // Register user profile on Express backend database
    fetch(API_BASE_URL + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: identifier, password, name, age, photo: customPhoto })
    })
    .then(res => res.json())
    .then(() => {
      localStorage.setItem('onboarding_photo', customPhoto);
      globalShowToast('Profile Saved', 'Profile registered successfully!', 'normal');
      navigate('/language');
    })
    .catch(() => {
      navigate('/language'); // local bypass fallback
    });
  };

  const handleSkip = (e) => {
    e.preventDefault();
    localStorage.removeItem('onboarding_photo');
    completeSetup('');
  };

  return (
    <section class="auth-section">
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Password</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Details</div>
        </div>
        <div class="step-indicator active">
          <div class="step-number">5</div>
          <div class="step-label">Avatar</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active">
          <button class="btn-back" onClick={() => navigate('/details')}><i class="fa-solid fa-arrow-left"></i></button>

          <h2 class="auth-title">Add Profile Photo</h2>
          <p class="auth-subtitle">Add a picture so friends recognize you</p>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
            <div class="avatar-ring-photo" onClick={() => fileInputRef.current.click()}>
              {photo ? (
                <img src={photo} alt="Preview" class="photo-preview" />
              ) : (
                <>
                  <i class="fa-solid fa-camera art-icon-photo-fallback"></i>
                  <span class="badge-camera-click"><i class="fa-solid fa-plus"></i></span>
                </>
              )}
            </div>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/*"
            onChange={handleGallerySelect}
          />

          <div class="photo-recommendation-box">
            <i class="fa-regular fa-image size-box-icon"></i>
            <div class="rec-texts">
              <strong>Recommended spec:</strong>
              <span>Square (400 x 400 pixels)</span>
              <span class="file-limits">JPG, PNG • Max 5MB</span>
            </div>
          </div>

          <div class="photo-actions-row">
            <button class="btn-photo-action" onClick={() => fileInputRef.current.click()}>
              <i class="fa-regular fa-images"></i>
              <span>Choose Gallery</span>
            </button>
            <button class="btn-photo-action" onClick={startCamera}>
              <i class="fa-solid fa-camera"></i>
              <span>Take Photo</span>
            </button>
          </div>

          <a href="#" class="skip-photo-link" onClick={handleSkip}>Skip for now</a>

          <button class="btn-primary" onClick={() => completeSetup(photo)}>
            <span>Complete Setup</span>
            <i class="fa-solid fa-circle-check"></i>
          </button>
        </div>
      </div>

      {/* Camera Capture Modal */}
      {showWebcam && (
        <div class="camera-modal">
          <div class="camera-modal-backdrop" onClick={stopCamera}></div>
          <div class="camera-modal-card">
            <div class="camera-modal-header">
              <h3>Webcam Stream</h3>
              <button class="btn-close-modal" onClick={stopCamera}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="camera-stream-wrapper">
              <video ref={videoRef} autoPlay playsInline id="webcam-stream"></video>
              <div className={`camera-shutter-flash ${flash ? 'flash' : ''}`}></div>
            </div>
            <canvas ref={canvasRef} width={400} height={400} style={{ display: 'none' }}></canvas>
            <div class="camera-modal-footer">
              <button class="btn-primary btn-capture" onClick={captureSnapshot}>
                <i class="fa-solid fa-camera-retro"></i> Capture Photo
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// =================================================================
// STEP 6: language.html (App UI Language)
// =================================================================
function Step6Language() {
  const navigate = useNavigate();
  const [uiLang, setUiLang] = useState(localStorage.getItem('settings_ui_lang') || 'en');
  const [activeLangDropdown, setActiveLangDropdown] = useState(false);
  const [langSearch, setLangSearch] = useState('');

  const identifier = localStorage.getItem('onboarding_id');
  useEffect(() => {
    if (!identifier) navigate('/');
  }, [identifier]);

  const handleComplete = () => {
    localStorage.setItem('settings_ui_lang', uiLang);
    localStorage.setItem('settings_chat_lang', uiLang);
    document.cookie = `googtrans=/en/${uiLang}; path=/; domain=${window.location.hostname}`;
    document.cookie = `googtrans=/en/${uiLang}; path=/;`;
    
    // Save language selection to backend database profile
    const identifier = localStorage.getItem('onboarding_id');
    fetch(API_BASE_URL + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: identifier, language: uiLang })
    })
    .finally(() => {
      navigate('/success');
      setTimeout(() => window.location.reload(), 100);
    });
  };

  return (
    <section class="auth-section" onClick={() => setActiveLangDropdown(false)}>
      <style>{`.hover-bg-light:hover { background: rgba(255,255,255,0.08); }`}</style>
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Password</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Details</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Avatar</div>
        </div>
        <div class="step-indicator active">
          <div class="step-number">6</div>
          <div class="step-label">Language</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active" onClick={(e) => e.stopPropagation()}>
          <button class="btn-back" onClick={() => navigate('/photo')}><i class="fa-solid fa-arrow-left"></i></button>

          <div class="card-art">
            <div class="avatar-ring">
              <i class="fa-solid fa-earth-americas art-icon-main"></i>
            </div>
          </div>

          <h2 class="auth-title">App Language</h2>
          <p class="auth-subtitle">Select the interface language</p>

          <div style={{ position: 'relative', margin: '2rem 0', width: '100%' }}>
            <button 
              onClick={() => { setActiveLangDropdown(!activeLangDropdown); setLangSearch(''); }}
              style={{ width: '100%', padding: '1rem', background: '#111928', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-md)', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontSize: '1.05rem', fontWeight: 500 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <i class="fa-solid fa-language" style={{ color: 'var(--primary-blue)' }}></i>
                <span>{TRANSLATION_LANGUAGES.find(l => l.code === uiLang)?.name || 'English'}</span>
              </div>
              <i class={`fa-solid fa-chevron-${activeLangDropdown ? 'up' : 'down'}`} style={{ color: 'var(--text-muted)' }}></i>
            </button>

            {activeLangDropdown && (
              <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#111928', border: '1px solid var(--primary-blue)', borderRadius: 'var(--radius-md)', marginTop: '0.5rem', zIndex: 100, maxHeight: '220px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', textAlign: 'left' }}>
                <div style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', position: 'sticky', top: 0, background: '#111928' }}>
                  <input type="text" placeholder="Search language..." value={langSearch} onChange={(e) => setLangSearch(e.target.value)} onClick={(e) => e.stopPropagation()} style={{ width: '100%', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '4px', color: 'white', outline: 'none' }} />
                </div>
                {TRANSLATION_LANGUAGES.filter(l => l.name.toLowerCase().includes(langSearch.toLowerCase())).map(l => (
                  <div key={l.code} onClick={() => { setUiLang(l.code); setActiveLangDropdown(false); }} style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="hover-bg-light">
                    {l.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button class="btn-primary" onClick={handleComplete}>
            <span>Complete Setup</span>
            <i class="fa-solid fa-circle-check"></i>
          </button>
        </div>
      </div>
    </section>
  );
}

// =================================================================
// STEP 7: success.html (Setup Completed)
// =================================================================
function Step6Success() {
  const navigate = useNavigate();
  const name = localStorage.getItem('onboarding_name');
  const age = localStorage.getItem('onboarding_age');
  const id = localStorage.getItem('onboarding_id');
  const photo = localStorage.getItem('onboarding_photo');

  useEffect(() => {
    if (!id) navigate('/');
  }, [id]);

  const handleStartOver = () => {
    localStorage.removeItem('onboarding_id');
    localStorage.removeItem('onboarding_otp');
    localStorage.removeItem('onboarding_is_new');
    localStorage.removeItem('onboarding_is_reset');
    localStorage.removeItem('onboarding_password');
    localStorage.removeItem('onboarding_name');
    localStorage.removeItem('onboarding_age');
    localStorage.removeItem('onboarding_photo');
    navigate('/');
  };

  return (
    <section class="auth-section">
      <div class="stepper-wrapper">
        <div class="stepper-line"></div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Identifier</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Verify</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Password</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Details</div>
        </div>
        <div class="step-indicator completed">
          <div class="step-number"><i class="fa-solid fa-check"></i></div>
          <div class="step-label">Avatar</div>
        </div>
      </div>

      <div class="auth-cards-container">
        <div class="auth-card active">
          <div class="card-art">
            <div class="avatar-ring ring-success">
              <i class="fa-solid fa-circle-check art-icon-success"></i>
            </div>
          </div>
          <h2 class="auth-title">Setup Completed!</h2>
          <p class="auth-subtitle">Your profile is fully configured</p>

          <div class="profile-summary-card">
            <div class="summary-avatar-frame">
              {photo ? (
                <img src={photo} alt="Profile" class="summary-avatar-img" />
              ) : (
                <i class="fa-solid fa-circle-user summary-avatar-fallback"></i>
              )}
            </div>
            <div class="summary-details">
              <h3>{name || 'Explorer User'}</h3>
              <p><i class="fa-regular fa-calendar"></i> Age: <strong>{age || '25'}</strong></p>
              <p><i class="fa-regular fa-envelope"></i> ID: <strong style={{ wordBreak: 'break-all' }}>{id}</strong></p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
            <button class="btn-primary" onClick={() => navigate('/dashboard')}>
              Enter Chat Dashboard
            </button>
            <button
              className="btn-primary"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--card-border)', color: 'var(--text-muted)', boxShadow: 'none', marginTop: 0 }}
              onClick={handleStartOver}
            >
              Start Over / New Registration
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// =================================================================
// PAGE 7: dashboard.html (Chat List Dashboard)
// =================================================================
function Dashboard() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // 'profile', 'settings', 'about'
  const [liveTyping, setLiveTyping] = useState(localStorage.getItem('settings_live_typing') !== 'false');

  const [contacts, setContacts] = useState([]);
  const [newContactId, setNewContactId] = useState('');
  const [addContactModalOpen, setAddContactModalOpen] = useState(false);

  const [transInput, setTransInput] = useState('');
  const [transOutput, setTransOutput] = useState('');
  const [langFrom, setLangFrom] = useState('en');
  const [langTo, setLangTo] = useState('hi');
  const [isListeningFrom, setIsListeningFrom] = useState(false);
  const [isListeningTo, setIsListeningTo] = useState(false);
  const [langSearch, setLangSearch] = useState('');
  const [activeLangDropdown, setActiveLangDropdown] = useState(null); // 'from' or 'to'
  const phrasebookRecRef = useRef(null);

  const [activeSettingsLangDropdown, setActiveSettingsLangDropdown] = useState(false);
  const [settingsLangSearch, setSettingsLangSearch] = useState('');
  const [currentUiLang, setCurrentUiLang] = useState(localStorage.getItem('settings_ui_lang') || 'en');

  const handleChangeUiLang = (code) => {
    setCurrentUiLang(code);
    localStorage.setItem('settings_ui_lang', code);
    document.cookie = `googtrans=/en/${code}; path=/; domain=${window.location.hostname}`;
    document.cookie = `googtrans=/en/${code}; path=/;`;
    setTimeout(() => window.location.reload(), 100);
  };

  const handleTranslatePhrasebook = (text, sourceLang, targetLang, direction) => {
    if (!text.trim()) return;
    if (direction === 'forward') setTransOutput('Translating...');
    else setTransInput('Translating...');
    fetch(API_BASE_URL + '/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, fromLang: sourceLang, toLang: targetLang })
    })
    .then(res => res.json())
    .then(data => {
      if (direction === 'forward') setTransOutput(data.translatedText);
      else setTransInput(data.translatedText);
    })
    .catch(err => {
      console.error(err);
      if (direction === 'forward') setTransOutput(`[Error]`);
      else setTransInput(`[Error]`);
    });
  };

  const toggleVoicePhrasebook = (type) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      globalShowToast("Speech API Error", "Speech Recognition is not supported in this browser.", "normal");
      return;
    }
    const isCurrentlyListening = type === 'from' ? isListeningFrom : isListeningTo;
    if (isCurrentlyListening) {
      if (phrasebookRecRef.current) phrasebookRecRef.current.stop();
      if (type === 'from') setIsListeningFrom(false); else setIsListeningTo(false);
      return;
    }
    if (phrasebookRecRef.current) {
        try { phrasebookRecRef.current.stop(); } catch(e){}
    }
    setIsListeningFrom(false);
    setIsListeningTo(false);

    const rec = new SpeechRecognition();
    const langCode = type === 'from' ? langFrom : langTo;
    rec.lang = langCode === 'en' ? 'en-US' : (langCode === 'hi' ? 'hi-IN' : (langCode === 'fr' ? 'fr-FR' : (langCode === 'es' ? 'es-ES' : langCode)));
    rec.continuous = false;
    rec.interimResults = false;

    rec.onstart = () => {
      if (type === 'from') setIsListeningFrom(true); else setIsListeningTo(true);
      globalShowToast("Voice Translator", "Speak now...", "normal");
    };

    rec.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (type === 'from') {
          setTransInput(transcript);
          handleTranslatePhrasebook(transcript, langFrom, langTo, 'forward');
      } else {
          setTransOutput(transcript);
          handleTranslatePhrasebook(transcript, langTo, langFrom, 'backward');
      }
    };

    rec.onerror = (err) => {
      if (type === 'from') setIsListeningFrom(false); else setIsListeningTo(false);
    };

    rec.onend = () => {
      if (type === 'from') setIsListeningFrom(false); else setIsListeningTo(false);
    };

    phrasebookRecRef.current = rec;
    rec.start();
  };

  const handleCopyPhrase = (text) => {
    navigator.clipboard.writeText(text);
    globalShowToast("Copied", "Translation copied to clipboard!", "normal");
  };

  const userId = localStorage.getItem('onboarding_id');
  const [userName, setUserName] = useState(localStorage.getItem('onboarding_name') || 'Explorer User');
  const [userAge, setUserAge] = useState(localStorage.getItem('onboarding_age') || '25');
  const [userPhoto, setUserPhoto] = useState(localStorage.getItem('onboarding_photo') || '');

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(userName);
  const [editAge, setEditAge] = useState(userAge);
  const [editPhoto, setEditPhoto] = useState(userPhoto);
  const profileFileInputRef = useRef(null);

  const handleProfilePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        globalShowToast('File Too Large', 'Image must be less than 5MB.', 'normal');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        setEditPhoto(evt.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfile = () => {
    if (editName.trim().length < 2) {
      globalShowToast('Validation Error', 'Enter a valid name (2+ characters).', 'normal');
      return;
    }
    const ageVal = parseInt(editAge);
    if (isNaN(ageVal) || ageVal < 1 || ageVal > 120) {
      globalShowToast('Validation Error', 'Please enter a valid age (1-120).', 'normal');
      return;
    }

    localStorage.setItem('onboarding_name', editName.trim());
    localStorage.setItem('onboarding_age', editAge.trim());
    localStorage.setItem('onboarding_photo', editPhoto);
    
    setUserName(editName.trim());
    setUserAge(editAge.trim());
    setUserPhoto(editPhoto);

    fetch(API_BASE_URL + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: userId, 
        password: localStorage.getItem('onboarding_password') || 'Password123!', 
        name: editName.trim(), 
        age: editAge.trim(), 
        photo: editPhoto,
        language: currentUiLang
      })
    }).catch(err => console.error('Failed to update profile on server', err));

    setIsEditingProfile(false);
    globalShowToast('Profile Updated', 'Your profile has been saved successfully.', 'normal');
  };

  const handleDeleteContact = (e, contactId) => {
    e.stopPropagation();
    if (confirm(`Remove this contact from your chat list?`)) {
      fetch(API_BASE_URL + `/api/contacts/${userId}/${contactId}`, { method: 'DELETE' })
        .then(() => {
          setContacts(prev => prev.filter(c => c.id !== contactId));
          globalShowToast("Delete Contact", "Contact removed successfully.", "normal");
        })
        .catch(err => console.error(err));
    }
  };

  useEffect(() => {
    if (!userId) {
      navigate('/');
      return;
    }

    fetch(API_BASE_URL + `/api/contacts/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setContacts(data);
        }
      })
      .catch(err => console.error("Error fetching contacts:", err));

    // Connect socket for real-time online status updates
    const socket = io(API_BASE_URL || undefined);
    socket.emit('register_online', { userId });

    socket.on('user_status_change', ({ userId: changedId, online }) => {
      setContacts(prev => prev.map(c => {
        if (c.id.toLowerCase() === changedId.toLowerCase()) {
          return { ...c, online };
        }
        return c;
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [userId]);

  const filtered = contacts.filter(c =>
    (c.name && c.name.toLowerCase().includes(search.toLowerCase())) ||
    (c.snippet && c.snippet.toLowerCase().includes(search.toLowerCase())) ||
    (c.id && c.id.toLowerCase().includes(search.toLowerCase()))
  );

  const handleLogout = () => {
    localStorage.removeItem('onboarding_id');
    navigate('/');
  };

  const handleResetRegistration = () => {
    if (confirm("Are you sure you want to reset your registration details? This will delete your current session setup, but keep the registration accounts list.")) {
      localStorage.removeItem('onboarding_id');
      localStorage.removeItem('onboarding_otp');
      localStorage.removeItem('onboarding_is_new');
      localStorage.removeItem('onboarding_is_reset');
      localStorage.removeItem('onboarding_password');
      localStorage.removeItem('onboarding_name');
      localStorage.removeItem('onboarding_age');
      localStorage.removeItem('onboarding_photo');
      navigate('/');
    }
  };

  const toggleLiveTyping = () => {
    const nextVal = !liveTyping;
    setLiveTyping(nextVal);
    localStorage.setItem('settings_live_typing', nextVal ? 'true' : 'false');
    globalShowToast("Settings Saved", `Live translation preview is now ${nextVal ? 'Enabled' : 'Disabled'}.`, "normal");
  };

  const handleAddContact = (e) => {
    e.preventDefault();
    const contactIdClean = newContactId.trim().toLowerCase();
    if (!contactIdClean) return;

    fetch(API_BASE_URL + '/api/contacts/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, contactId: contactIdClean })
    })
    .then(async res => {
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add contact");
      }
      return data;
    })
    .then(data => {
      globalShowToast("Contact Added", `Successfully added ${data.contact.name || contactIdClean}!`, "normal");
      setAddContactModalOpen(false);
      setNewContactId('');
      // Refresh contacts list
      fetch(API_BASE_URL + `/api/contacts/${userId}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setContacts(data);
          }
        });
    })
    .catch(err => {
      globalShowToast("Error", err.message, "normal");
    });
  };

  return (
    <main class="dashboard-main-wrapper" onClick={() => setDropdownOpen(false)}>
      
      {/* Header */}
      <header class="app-header">
        <div class="header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div class="user-avatar-trigger" onClick={(e) => { e.stopPropagation(); setActiveModal('profile'); }}>
            {userPhoto ? (
              <img src={userPhoto} alt="User Avatar" class="header-avatar-img" />
            ) : (
              <i class="fa-solid fa-circle-user header-avatar-fallback"></i>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', lineHeight: 1.2 }}>{userName}</span>
          </div>
        </div>
        <div class="header-center">
          <h1 class="app-title-main">Smart Messenger</h1>
        </div>
        <div class="header-right" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button class="btn-header-option" title="AI Phrasebook" onClick={(e) => { e.stopPropagation(); setActiveModal('phrasebook'); }}>
            <i class="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--primary-blue)' }}></i>
          </button>
          <button class="btn-header-option" onClick={(e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen); }}>
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
      </header>

      {/* Options dropdown */}
      {dropdownOpen && (
        <div class="options-dropdown-menu">
          <button class="btn-dropdown-item" onClick={() => setActiveModal('profile')}><i class="fa-regular fa-user"></i> My Profile</button>
          <button class="btn-dropdown-item" onClick={() => setActiveModal('settings')}><i class="fa-solid fa-sliders"></i> Settings</button>
          <button class="btn-dropdown-item" onClick={() => setActiveModal('about')}><i class="fa-solid fa-circle-info"></i> About Project</button>
          <button class="btn-dropdown-item" onClick={handleResetRegistration}><i class="fa-solid fa-arrows-rotate"></i> Reset Registration</button>
          <button class="btn-dropdown-item logout" onClick={handleLogout}><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
        </div>
      )}

      {/* Search pill */}
      <div class="search-bar-container">
        <div class="search-wrapper-pill">
          <i class="fa-solid fa-magnifying-glass search-pill-icon"></i>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Chat list */}
      <section class="chats-list-container">
        <div class="chat-threads-list">
          {filtered.map(c => (
            <div key={c.id} class="chat-thread-item" onClick={() => navigate(`/chat/${c.id}`)}>
              <div className="thread-avatar-wrapper bg-blue-glow">
                {c.photo ? (
                  <img src={c.photo} alt={c.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <i className="fa-solid fa-user thread-avatar-fallback"></i>
                )}
                <span className={`thread-status-dot ${c.online ? 'online' : 'offline'}`}></span>
              </div>
              <div class="thread-body">
                <div class="thread-title-row">
                  <span class="thread-name">{c.name || c.id}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span class="thread-time">{c.time}</span>
                    <button 
                      onClick={(e) => handleDeleteContact(e, c.id)} 
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', outline: 'none', padding: '0.2rem', display: 'flex', alignItems: 'center' }} 
                      title="Delete Contact"
                    >
                      <i class="fa-regular fa-trash-can" style={{ fontSize: '0.85rem' }}></i>
                    </button>
                  </div>
                </div>
                <div class="thread-msg-row">
                  <span class="thread-snippet">{c.snippet}</span>
                  <span class="thread-lang-badge">{c.badge}</span>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: '3rem', color: 'var(--text-muted)' }}>
              <i class="fa-regular fa-comments" style={{ fontSize: '2.5rem', marginBottom: '1rem', display: 'block', opacity: 0.5 }}></i>
              <p>No chats yet. Click the + button to add a contact!</p>
            </div>
          )}
        </div>
      </section>

      <button class="fab-green" onClick={() => setAddContactModalOpen(true)}>
        <i class="fa-solid fa-user-plus"></i>
      </button>

      {/* ADD CONTACT MODAL */}
      {addContactModalOpen && (
        <div class="custom-modal">
          <div class="custom-modal-backdrop" onClick={() => setAddContactModalOpen(false)}></div>
          <div class="custom-modal-card">
            <div class="custom-modal-header">
              <h3>Add Contact</h3>
              <button class="btn-close-modal" onClick={() => setAddContactModalOpen(false)}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="custom-modal-body">
              <form onSubmit={handleAddContact} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
                <div class="input-group">
                  <span class="field-label">Email or Mobile Number</span>
                  <div class="input-wrapper">
                    <i class="fa-solid fa-user input-icon"></i>
                    <input
                      type="text"
                      placeholder="Enter contact's email or mobile number"
                      value={newContactId}
                      onChange={(e) => setNewContactId(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <button type="submit" class="btn-primary" style={{ marginTop: '0.5rem' }}>
                  <span>Add Contact</span>
                  <i class="fa-solid fa-user-plus"></i>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* PROFILE MODAL */}
      {activeModal === 'profile' && (
        <div class="custom-modal">
          <div class="custom-modal-backdrop" onClick={() => { setActiveModal(null); setIsEditingProfile(false); setEditName(userName); setEditAge(userAge); setEditPhoto(userPhoto); }}></div>
          <div class="custom-modal-card">
            <div class="custom-modal-header">
              <h3>{isEditingProfile ? 'Edit Profile' : 'My Profile'}</h3>
              <button class="btn-close-modal" onClick={() => { setActiveModal(null); setIsEditingProfile(false); setEditName(userName); setEditAge(userAge); setEditPhoto(userPhoto); }}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="custom-modal-body">
              {isEditingProfile ? (
                <>
                  <div class="profile-modal-avatar-wrapper" style={{ cursor: 'pointer', position: 'relative' }} onClick={() => profileFileInputRef.current.click()}>
                    {editPhoto ? (
                      <img src={editPhoto} alt="User Avatar" class="profile-modal-avatar" />
                    ) : (
                      <i class="fa-solid fa-camera profile-modal-fallback"></i>
                    )}
                    <div style={{ position: 'absolute', bottom: '0', right: '0', background: 'var(--primary-blue)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', border: '3px solid var(--modal-bg)' }}>
                      <i class="fa-solid fa-pencil" style={{ fontSize: '14px' }}></i>
                    </div>
                  </div>
                  <input type="file" ref={profileFileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleProfilePhotoChange} />
                  
                  <div class="input-group" style={{ width: '100%', marginBottom: '1rem' }}>
                    <span class="field-label">Full Name</span>
                    <div class="input-wrapper">
                      <i class="fa-solid fa-signature input-icon"></i>
                      <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-main)', outline: 'none' }} />
                    </div>
                  </div>
                  
                  <div class="input-group" style={{ width: '100%', marginBottom: '1rem' }}>
                    <span class="field-label">Age</span>
                    <div class="input-wrapper">
                      <i class="fa-solid fa-calendar input-icon"></i>
                      <input type="number" value={editAge} onChange={(e) => setEditAge(e.target.value)} style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-main)', outline: 'none' }} />
                    </div>
                  </div>
                  
                  <button class="btn-primary" onClick={handleSaveProfile} style={{ marginTop: '0.5rem', width: '100%' }}>Save Changes</button>
                  <button class="btn-primary" onClick={() => { setIsEditingProfile(false); setEditName(userName); setEditAge(userAge); setEditPhoto(userPhoto); }} style={{ marginTop: '0.5rem', width: '100%', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--card-border)', boxShadow: 'none' }}>Cancel</button>
                </>
              ) : (
                <>
                  <div class="profile-modal-avatar-wrapper">
                    {userPhoto ? (
                      <img src={userPhoto} alt="User Avatar" class="profile-modal-avatar" />
                    ) : (
                      <i class="fa-solid fa-circle-user profile-modal-fallback"></i>
                    )}
                  </div>
                  <div class="info-item">
                    <span class="info-item-label">Full Name</span>
                    <span class="info-item-value">{userName}</span>
                  </div>

                  <div class="info-item">
                    <span class="info-item-label">Age</span>
                    <span class="info-item-value">{userAge}</span>
                  </div>
                  
                  <div class="info-item">
                    <span class="info-item-label">Email / Phone</span>
                    <span class="info-item-value">{userId}</span>
                  </div>

                  <button class="btn-primary" onClick={() => setIsEditingProfile(true)} style={{ marginTop: '1rem', width: '100%' }}>
                    <i class="fa-solid fa-pencil"></i> Edit Profile
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {activeModal === 'settings' && (
        <div class="custom-modal">
          <div class="custom-modal-backdrop" onClick={() => setActiveModal(null)}></div>
          <div class="custom-modal-card">
            <div class="custom-modal-header">
              <h3>Settings</h3>
              <button class="btn-close-modal" onClick={() => setActiveModal(null)}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="custom-modal-body" onClick={() => setActiveSettingsLangDropdown(false)}>
              
              <div class="settings-toggle-row" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-main)' }}>App Language</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Translate entire interface</span>
                  </div>
                </div>
                
                <div style={{ position: 'relative', width: '100%' }}>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setActiveSettingsLangDropdown(!activeSettingsLangDropdown); setSettingsLangSearch(''); }}
                    style={{ width: '100%', padding: '0.6rem 0.75rem', background: '#111928', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontWeight: 500 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                       <i class="fa-solid fa-earth-americas" style={{ color: 'var(--primary-blue)' }}></i>
                       <span>{TRANSLATION_LANGUAGES.find(l => l.code === currentUiLang)?.name || 'English'}</span>
                    </div>
                    <i class="fa-solid fa-chevron-down" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}></i>
                  </button>
                  {activeSettingsLangDropdown && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#111928', border: '1px solid var(--primary-blue)', borderRadius: 'var(--radius-sm)', marginTop: '0.5rem', zIndex: 100, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                      <div style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', position: 'sticky', top: 0, background: '#111928' }}>
                        <input type="text" placeholder="Search language..." value={settingsLangSearch} onChange={(e) => setSettingsLangSearch(e.target.value)} onClick={(e) => e.stopPropagation()} style={{ width: '100%', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '4px', color: 'white', outline: 'none' }} />
                      </div>
                      {TRANSLATION_LANGUAGES.filter(l => l.name.toLowerCase().includes(settingsLangSearch.toLowerCase())).map(l => (
                        <div key={l.code} onClick={() => { handleChangeUiLang(l.code); setActiveSettingsLangDropdown(false); }} style={{ padding: '0.6rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="hover-bg-light">
                          {l.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div class="settings-toggle-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-main)' }}>Sound Notifications</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Play sounds for incoming/outgoing chats</span>
                </div>
                <label class="switch">
                  <input type="checkbox" defaultChecked />
                  <span class="slider"></span>
                </label>
              </div>
              
              <div class="settings-toggle-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-main)' }}>Live Typing Preview</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Translate text in real-time as you type</span>
                </div>
                <label class="switch">
                  <input type="checkbox" checked={liveTyping} onChange={toggleLiveTyping} />
                  <span class="slider"></span>
                </label>
              </div>

              <div class="settings-toggle-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-main)' }}>Chat Theme</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Select chat screen appearance</span>
                </div>
                <select style={{ background: 'rgba(15,23,42,0.9)', border: '1px solid var(--card-border)', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '0.8rem', borderRadius: '4px', padding: '0.25rem 0.5rem', outline: 'none', cursor: 'pointer' }}>
                  <option value="dark-green">WhatsApp Dark Green</option>
                  <option value="dark-blue">SmartChat Dark Blue</option>
                  <option value="dark-purple">Glassmorphism Dark Purple</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABOUT MODAL */}
      {activeModal === 'about' && (
        <div class="custom-modal">
          <div class="custom-modal-backdrop" onClick={() => setActiveModal(null)}></div>
          <div class="custom-modal-card">
            <div class="custom-modal-header">
              <h3>About Smart Messenger</h3>
              <button class="btn-close-modal" onClick={() => setActiveModal(null)}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="custom-modal-body" style={{ fontSize: '0.85rem', lineHeight: 1.5, gap: '0.85rem' }}>
              <p><strong>Smart Messenger</strong> is a full-stack real-time translation chat application designed to bridge the language gap in human-to-human communications.</p>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0.25rem 0' }}></div>
              <p><i class="fa-solid fa-bolt" style={{ color: 'var(--primary-blue)', marginRight: '0.4rem', width: '14px' }}></i><strong>WebSocket Engine:</strong> Handled by Socket.io and node server to relay chats in real-time between clients.</p>
              <p><i class="fa-solid fa-gears" style={{ color: 'var(--success-green)', marginRight: '0.4rem', width: '14px' }}></i><strong>MyMemory Integration:</strong> Dynamic proxies on the server resolve translations with robust offline fallbacks.</p>
              <p><i class="fa-solid fa-wand-magic-sparkles" style={{ color: '#a855f7', marginRight: '0.4rem', width: '14px' }}></i><strong>React Architecture:</strong> Re-scaffolded using modular components, React Router DOM, hooks, and clean state hooks.</p>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '0.25rem 0' }}></div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center' }}>Version 2.0.0 • Created by Antigravity</p>
            </div>
          </div>
        </div>
      )}
            {/* PHRASEBOOK MODAL */}
      {activeModal === 'phrasebook' && (
        <div class="custom-modal">
          <div class="custom-modal-backdrop" onClick={() => { setActiveModal(null); setActiveLangDropdown(null); }}></div>
          <div class="custom-modal-card" style={{ maxWidth: '700px', width: '90%' }}>
            <div class="custom-modal-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <i class="fa-solid fa-language" style={{ fontSize: '1.5rem', color: 'var(--primary-blue)' }}></i>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Universal Translator</h3>
              </div>
              <button class="btn-close-modal" onClick={() => { setActiveModal(null); setActiveLangDropdown(null); }}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="custom-modal-body" style={{ gap: '1.5rem', padding: '1.5rem', background: 'var(--bg-dark)' }}>
              <style>{`.hover-bg-light:hover { background: rgba(255,255,255,0.08); }`}</style>
              
              {/* Language Selector Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: 'var(--radius-md)', position: 'relative' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <button 
                    onClick={() => { setActiveLangDropdown(activeLangDropdown === 'from' ? null : 'from'); setLangSearch(''); }}
                    style={{ width: '100%', padding: '0.75rem', background: '#111928', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontWeight: 500 }}
                  >
                    <span>{TRANSLATION_LANGUAGES.find(l => l.code === langFrom)?.name || 'Select Language'}</span>
                    <i class="fa-solid fa-chevron-down" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}></i>
                  </button>
                  {activeLangDropdown === 'from' && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#111928', border: '1px solid var(--primary-blue)', borderRadius: 'var(--radius-sm)', marginTop: '0.5rem', zIndex: 100, maxHeight: '300px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                      <div style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', position: 'sticky', top: 0, background: '#111928' }}>
                        <input type="text" placeholder="Search language..." value={langSearch} onChange={(e) => setLangSearch(e.target.value)} onClick={(e) => e.stopPropagation()} style={{ width: '100%', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '4px', color: 'white', outline: 'none' }} />
                      </div>
                      {TRANSLATION_LANGUAGES.filter(l => l.name.toLowerCase().includes(langSearch.toLowerCase())).map(l => (
                        <div key={l.code} onClick={() => { setLangFrom(l.code); setActiveLangDropdown(null); }} style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="hover-bg-light">
                          {l.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => { const temp = langFrom; setLangFrom(langTo); setLangTo(temp); const tempText = transInput; setTransInput(transOutput); setTransOutput(tempText); }}
                  style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--primary-blue)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)' }}
                  title="Swap Languages"
                >
                  <i class="fa-solid fa-right-left"></i>
                </button>

                <div style={{ flex: 1, position: 'relative' }}>
                  <button 
                    onClick={() => { setActiveLangDropdown(activeLangDropdown === 'to' ? null : 'to'); setLangSearch(''); }}
                    style={{ width: '100%', padding: '0.75rem', background: '#111928', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontWeight: 500 }}
                  >
                    <span>{TRANSLATION_LANGUAGES.find(l => l.code === langTo)?.name || 'Select Language'}</span>
                    <i class="fa-solid fa-chevron-down" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}></i>
                  </button>
                  {activeLangDropdown === 'to' && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#111928', border: '1px solid var(--primary-blue)', borderRadius: 'var(--radius-sm)', marginTop: '0.5rem', zIndex: 100, maxHeight: '300px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                      <div style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', position: 'sticky', top: 0, background: '#111928' }}>
                        <input type="text" placeholder="Search language..." value={langSearch} onChange={(e) => setLangSearch(e.target.value)} onClick={(e) => e.stopPropagation()} style={{ width: '100%', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '4px', color: 'white', outline: 'none' }} />
                      </div>
                      {TRANSLATION_LANGUAGES.filter(l => l.name.toLowerCase().includes(langSearch.toLowerCase())).map(l => (
                        <div key={l.code} onClick={() => { setLangTo(l.code); setActiveLangDropdown(null); }} style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.02)' }} className="hover-bg-light">
                          {l.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Translation Panels */}
              <div style={{ display: 'flex', gap: '1rem', flexDirection: window.innerWidth < 600 ? 'column' : 'row' }}>
                {/* Left Panel */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ position: 'relative', width: '100%', height: '180px', background: '#111928', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <textarea
                      placeholder={`Type in ${TRANSLATION_LANGUAGES.find(l => l.code === langFrom)?.name || 'Language'}...`}
                      value={transInput}
                      onChange={(e) => setTransInput(e.target.value)}
                      style={{ flex: 1, width: '100%', background: 'transparent', border: 'none', padding: '1rem', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '1.05rem', resize: 'none', outline: 'none', lineHeight: 1.5 }}
                      lang={langFrom}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <button onClick={() => toggleVoicePhrasebook('from')} style={{ background: 'none', border: 'none', color: isListeningFrom ? 'var(--error-red)' : 'var(--primary-blue)', cursor: 'pointer', outline: 'none', fontSize: '1.25rem', padding: '0.25rem' }} title="Dictate Voice">
                        <i class={`fa-solid ${isListeningFrom ? 'fa-microphone fa-bounce' : 'fa-microphone'}`}></i>
                      </button>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => { setTransInput(''); setTransOutput(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', outline: 'none', padding: '0.25rem' }} title="Clear">
                          <i class="fa-solid fa-trash"></i>
                        </button>
                        <button onClick={() => handleTranslatePhrasebook(transInput, langFrom, langTo, 'forward')} style={{ background: 'var(--primary-blue)', border: 'none', color: 'white', cursor: 'pointer', outline: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }} title="Translate">
                          Translate <i class="fa-solid fa-arrow-right" style={{ marginLeft: '0.25rem' }}></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Panel */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ position: 'relative', width: '100%', height: '180px', background: '#111928', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <textarea
                      placeholder={`Type in ${TRANSLATION_LANGUAGES.find(l => l.code === langTo)?.name || 'Language'}...`}
                      value={transOutput}
                      onChange={(e) => setTransOutput(e.target.value)}
                      style={{ flex: 1, width: '100%', background: 'transparent', border: 'none', padding: '1rem', color: 'var(--text-main)', fontFamily: 'inherit', fontSize: '1.05rem', resize: 'none', outline: 'none', lineHeight: 1.5 }}
                      lang={langTo}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 1rem', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <button onClick={() => toggleVoicePhrasebook('to')} style={{ background: 'none', border: 'none', color: isListeningTo ? 'var(--error-red)' : 'var(--primary-blue)', cursor: 'pointer', outline: 'none', fontSize: '1.25rem', padding: '0.25rem' }} title="Dictate Voice">
                        <i class={`fa-solid ${isListeningTo ? 'fa-microphone fa-bounce' : 'fa-microphone'}`}></i>
                      </button>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={() => handleCopyPhrase(transOutput)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', outline: 'none', padding: '0.25rem' }} title="Copy">
                          <i class="fa-regular fa-copy"></i>
                        </button>
                        <button onClick={() => handleTranslatePhrasebook(transOutput, langTo, langFrom, 'backward')} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', cursor: 'pointer', outline: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }} title="Translate Back">
                          <i class="fa-solid fa-arrow-left" style={{ marginRight: '0.25rem' }}></i> Translate
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// =================================================================
// PAGE 8: chat.html (Active Chat Details & Real-Time translation)
// =================================================================
function ChatDetail() {
  const navigate = useNavigate();
  const { contactId } = useParams();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [previewValue, setPreviewValue] = useState('');
  const [previewVisible, setPreviewVisible] = useState(false);
  const [contactUser, setContactUser] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  
  const userId = localStorage.getItem('onboarding_id');
  const socketRef = useRef(null);
  const scrollRef = useRef(null);
  const translationTimeoutRef = useRef(null);

  const [userLang, setUserLang] = useState(localStorage.getItem('settings_chat_lang') || localStorage.getItem('settings_ui_lang') || 'en');
  const [partnerLang, setPartnerLang] = useState('en');
  const [isPartnerOnline, setIsPartnerOnline] = useState(false);
  const imageInputRef = useRef(null);

  // Image Lightbox state
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPos, setLightboxPos] = useState({ x: 0, y: 0 });
  const lightboxDragRef = useRef({ dragging: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0 });

  // Language locale map for speech recognition
  const LANG_LOCALE_MAP = {
    'hi': 'hi-IN', 'bn': 'bn-IN', 'te': 'te-IN', 'ta': 'ta-IN',
    'mr': 'mr-IN', 'gu': 'gu-IN', 'kn': 'kn-IN', 'ml': 'ml-IN',
    'ur': 'ur-IN', 'pa': 'pa-IN', 'or': 'or-IN',
    'ja': 'ja-JP', 'es': 'es-ES', 'fr': 'fr-FR', 'de': 'de-DE',
    'zh': 'zh-CN', 'ru': 'ru-RU', 'ko': 'ko-KR', 'ar': 'ar-SA',
    'it': 'it-IT', 'pt': 'pt-BR', 'en': 'en-US'
  };

  const handleUserLangChange = (newLang) => {
    setUserLang(newLang);
    localStorage.setItem('settings_chat_lang', newLang);
    
    fetch(API_BASE_URL + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, language: newLang })
    }).catch(err => console.error("Failed to update language on server:", err));
  };

  const handleSendImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
      globalShowToast("Error", "Image is too large. Please select an image under 2MB.", "normal");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64String = reader.result;
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const msgId = Math.random().toString(36).substring(2, 9);
      const msgPayload = {
        id: msgId,
        userId,
        contactId,
        translation: '[Image Shared]',
        original: '[Image Shared]',
        image: base64String,
        time: timeStr
      };
      
      socketRef.current.emit('send_msg', msgPayload);
      
      setMessages(prev => [...prev, {
        id: msgId,
        sender: 'outgoing',
        translation: '[Image Shared]',
        original: '[Image Shared]',
        image: base64String,
        time: timeStr
      }]);
      
      setTimeout(scrollToBottom, 50);
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteMessage = (msgId) => {
    if (!msgId) return;
    if (confirm("Delete this message?")) {
      const room = [userId.toLowerCase(), contactId.toLowerCase()].sort().join('_');
      fetch(API_BASE_URL + `/api/message/${room}/${msgId}`, { method: 'DELETE' })
        .then(() => {
          setMessages(prev => prev.filter(m => m.id !== msgId));
        })
        .catch(err => console.error(err));
    }
  };

  const toggleVoiceListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      globalShowToast("Speech Not Supported", "Voice input is not available in this browser or app. Please type your message instead.", "normal");
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
      }
      setIsListening(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.lang = LANG_LOCALE_MAP[userLang] || 'en-US';
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsListening(true);
        globalShowToast("Voice Recognition", `Listening in ${TRANSLATION_LANGUAGES.find(l => l.code === userLang)?.name || 'English'}...`, "normal");
      };

      rec.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputValue(prev => prev ? prev + ' ' + transcript : transcript);
        globalShowToast("Voice Captured", `"${transcript}"`, "normal");
      };

      rec.onerror = (err) => {
        console.error("Speech recognition error:", err);
        setIsListening(false);
        if (err.error === 'not-allowed' || err.error === 'service-not-allowed') {
          globalShowToast("Microphone Blocked", "Please allow microphone access in your browser/app settings.", "normal");
        } else if (err.error === 'no-speech') {
          globalShowToast("No Speech", "No speech was detected. Please try again.", "normal");
        } else {
          globalShowToast("Voice Error", `Error: ${err.error || "Failed to capture speech. Try Chrome browser."}`, "normal");
        }
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (startErr) {
      console.error("Failed to start speech recognition:", startErr);
      setIsListening(false);
      globalShowToast("Voice Error", "Could not start voice input. Try using Chrome browser on your device.", "normal");
    }
  };

  // Fetch contact user details
  useEffect(() => {
    if (!contactId) return;
    fetch(API_BASE_URL + `/api/users/${contactId}`)
      .then(res => res.json())
      .then(data => {
        setContactUser(data);
        if (data.language) {
          setPartnerLang(data.language);
        }
      })
      .catch(err => {
        console.error("Error fetching contact details:", err);
        setContactUser({ id: contactId, name: contactId, photo: '', language: 'en' });
      });
  }, [contactId]);

  // Set up WebSockets & fetch past history
  useEffect(() => {
    if (!userId) {
      navigate('/');
      return;
    }

    // Fetch initial chat logs from Server DB
    fetch(API_BASE_URL + `/api/messages/${userId}/${contactId}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data);
        setTimeout(scrollToBottom, 200);
      })
      .catch(err => console.error(err));

    // Connect WebSocket
    socketRef.current = io(API_BASE_URL || undefined);
    socketRef.current.emit('join_chat', { userId, contactId });

    // Listeners
    socketRef.current.on('receive_msg', (msg) => {
      setMessages(prev => [...prev, msg]);
      setTimeout(scrollToBottom, 50);
    });

    socketRef.current.on('partner_status', ({ contactId: cId, online }) => {
      if (cId.toLowerCase() === contactId.toLowerCase()) {
        setIsPartnerOnline(online);
      }
    });

    socketRef.current.on('user_status_change', ({ userId: changedId, online }) => {
      if (changedId.toLowerCase() === contactId.toLowerCase()) {
        setIsPartnerOnline(online);
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [userId, contactId]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  // Debounced translation request
  useEffect(() => {
    clearTimeout(translationTimeoutRef.current);
    if (!inputValue.trim()) {
      setPreviewVisible(false);
      setPreviewValue('');
      return;
    }

    const isLiveTyping = localStorage.getItem('settings_live_typing') !== 'false';
    if (!isLiveTyping) {
      setPreviewVisible(false);
      return;
    }

    setPreviewVisible(true);
    setPreviewValue('Translating...');

    translationTimeoutRef.current = setTimeout(() => {
      fetch(API_BASE_URL + '/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputValue, fromLang: userLang, toLang: partnerLang })
      })
      .then(res => res.json())
      .then(data => {
        setPreviewValue(data.translatedText);
      })
      .catch(err => {
        console.error(err);
        setPreviewValue(`[${partnerLang.toUpperCase()}] ${inputValue}`);
      });
    }, 500);

    return () => clearTimeout(translationTimeoutRef.current);
  }, [inputValue, userLang, partnerLang]);

  // Send Message
  const handleSend = async (e) => {
    e.preventDefault();
    const textClean = inputValue.trim();
    if (!textClean) return;

    setInputValue('');
    setPreviewVisible(false);

    // Get final translated text
    let finalTranslation = previewValue;
    if (!finalTranslation || finalTranslation === 'Translating...' || finalTranslation === '...') {
      try {
        const res = await fetch(API_BASE_URL + '/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textClean, fromLang: userLang, toLang: partnerLang })
        });
        const data = await res.json();
        finalTranslation = data.translatedText;
      } catch {
        finalTranslation = `[${partnerLang.toUpperCase()}] ${textClean}`;
      }
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const msgId = Math.random().toString(36).substring(2, 9);
    const msgPayload = {
      id: msgId,
      userId,
      contactId,
      translation: finalTranslation,
      original: textClean,
      time: timeStr
    };

    // Emit via WebSocket to Server (which saves to DB & relays)
    socketRef.current.emit('send_msg', msgPayload);

    // Add locally to state immediately
    setMessages(prev => [...prev, {
      id: msgId,
      sender: 'outgoing',
      translation: finalTranslation,
      original: textClean,
      time: timeStr
    }]);

    setTimeout(scrollToBottom, 50);
  };

  const handleClearChat = () => {
    if (confirm("Are you sure you want to clear chat history for this contact?")) {
      fetch(API_BASE_URL + `/api/messages/${userId}/${contactId}`, { method: 'DELETE' })
        .then(() => {
          setMessages([]);
          globalShowToast("Clear History", "Chat history deleted successfully.", "normal");
        });
    }
  };

  return (
    <main class="chat-main-wrapper" onClick={() => setDropdownOpen(false)}>
      
      {/* Chat Header */}
      <header class="chat-header">
        <div class="chat-header-left">
          <button class="btn-back-chat" onClick={() => navigate('/dashboard')}>
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div className="chat-partner-avatar-wrapper bg-blue-glow">
            {contactUser && contactUser.photo ? (
              <img src={contactUser.photo} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <i className="fa-solid fa-user" id="partner-avatar-fallback"></i>
            )}
            <span className={`partner-status-dot ${isPartnerOnline ? 'online' : 'offline'}`}></span>
          </div>
          <div class="chat-partner-info">
            <h2 class="chat-partner-name">{contactUser ? contactUser.name : contactId}</h2>
            <span className="chat-partner-status">{isPartnerOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>

        {/* Translation Pill */}
        <div class="chat-header-center">
          <div class="lang-selector-pill" style={{ padding: '0.35rem 0.75rem' }}>
            <i class="fa-solid fa-language lang-arrow-icon" style={{ fontSize: '0.9rem', marginRight: '0.2rem' }}></i>
            <select 
              value={userLang} 
              onChange={(e) => handleUserLangChange(e.target.value)} 
              title="My Language"
              style={{ fontSize: '0.85rem' }}
            >
              {TRANSLATION_LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div class="chat-header-right">
          <button class="btn-header-option" onClick={(e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen); }}>
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
      </header>

      {/* Options dropdown */}
      {dropdownOpen && (
        <div class="options-dropdown-menu" id="chat-options-dropdown">
          <button class="btn-dropdown-item" onClick={handleClearChat}><i class="fa-regular fa-trash-can"></i> Clear Chat History</button>
          <button class="btn-dropdown-item" onClick={() => { setUserLang(localStorage.getItem('settings_chat_lang') || localStorage.getItem('settings_ui_lang') || 'en'); setPartnerLang(contactUser?.language || 'en'); }}><i class="fa-solid fa-arrows-rotate"></i> Reset Languages</button>
        </div>
      )}

      {/* Messages Thread scroll window */}
      <section class="chat-messages-window" ref={scrollRef}>
        <div class="chat-messages-scroll">
          <div class="system-message-bubble">
            <i class="fa-solid fa-lock"></i>
            <span>Messages are translated in real-time. Typing translations will appear as a preview balloon above the input.</span>
          </div>

          {messages.map((m) => (
            <div key={m.id || Math.random()} class={`message-bubble ${m.sender}`} style={{ position: 'relative' }}>
              {m.image ? (
                <div style={{ cursor: 'pointer', position: 'relative' }} onClick={() => { setLightboxImage(m.image); setLightboxZoom(1); setLightboxPos({ x: 0, y: 0 }); }}>
                  <img 
                    src={m.image} 
                    alt="Shared" 
                    style={{ maxWidth: '100%', maxHeight: '220px', borderRadius: '10px', marginBottom: '0.4rem', display: 'block', objectFit: 'cover', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }} 
                  />
                  <div style={{ position: 'absolute', bottom: '0.65rem', right: '0.5rem', background: 'rgba(0,0,0,0.55)', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i class="fa-solid fa-expand" style={{ color: 'white', fontSize: '0.7rem' }}></i>
                  </div>
                </div>
              ) : (
                <>
                  <span class="msg-translation-text">{m.translation}</span>
                  <span class="msg-original-text">{m.original}</span>
                </>
              )}
              <div class="msg-bubble-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '0.5rem' }}>
                <button 
                  onClick={() => handleDeleteMessage(m.id)} 
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', outline: 'none', padding: '0.15rem', display: 'flex', alignItems: 'center' }} 
                  title="Delete message"
                >
                  <i class="fa-regular fa-trash-can" style={{ fontSize: '0.75rem' }}></i>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span class="msg-time">{m.time}</span>
                  {m.sender === 'outgoing' && <i class="fa-solid fa-check msg-status read"></i>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Input controls */}
      <footer class="chat-input-section">
        {previewVisible && (
          <div class="translation-preview-balloon">
            <span class="preview-tag">Translation Preview:</span>
            <p class="preview-text">{previewValue}</p>
            <div class="preview-balloon-arrow"></div>
          </div>
        )}

        <form onSubmit={handleSend} class="chat-input-controls">
          <div class="input-actions-left">
            <input 
              type="file" 
              ref={imageInputRef} 
              style={{ display: 'none' }} 
              accept="image/*" 
              onChange={handleSendImage} 
            />
            <button type="button" class="btn-input-action" onClick={() => imageInputRef.current.click()}>
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
          <div class="input-text-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              placeholder={isListening ? "Listening... Speak now..." : "Type a message..."}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              autocomplete="off"
              style={{ paddingRight: '2.5rem' }}
              lang={userLang}
            />
            <button 
              type="button" 
              onClick={toggleVoiceListening}
              style={{ position: 'absolute', right: '0.75rem', background: 'none', border: 'none', color: isListening ? 'var(--error-red)' : 'var(--text-muted)', cursor: 'pointer', outline: 'none', padding: '0.25rem' }}
              title="Voice Translator"
            >
              <i class={`fa-solid ${isListening ? 'fa-microphone fa-bounce' : 'fa-microphone'}`} style={{ fontSize: '1.1rem' }}></i>
            </button>
          </div>
          <div class="input-actions-right">
            <button type="submit" class="btn-send-message">
              <i class="fa-solid fa-paper-plane"></i>
            </button>
          </div>
        </form>
      </footer>

      {/* Image Lightbox Fullscreen Viewer */}
      {lightboxImage && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)' }}
          onClick={() => { setLightboxImage(null); setLightboxZoom(1); setLightboxPos({ x: 0, y: 0 }); }}
        >
          {/* Top bar with controls */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', zIndex: 10 }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', fontWeight: 500 }}>
              <i class="fa-regular fa-image" style={{ marginRight: '0.4rem' }}></i> Image Preview
            </span>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button 
                onClick={(e) => { e.stopPropagation(); setLightboxZoom(z => Math.max(0.5, z - 0.25)); }}
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}
                title="Zoom Out"
              >
                <i class="fa-solid fa-minus"></i>
              </button>
              <span style={{ color: 'white', fontSize: '0.8rem', minWidth: '40px', textAlign: 'center' }}>{Math.round(lightboxZoom * 100)}%</span>
              <button 
                onClick={(e) => { e.stopPropagation(); setLightboxZoom(z => Math.min(4, z + 0.25)); }}
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}
                title="Zoom In"
              >
                <i class="fa-solid fa-plus"></i>
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); setLightboxZoom(1); setLightboxPos({ x: 0, y: 0 }); }}
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}
                title="Reset Zoom"
              >
                <i class="fa-solid fa-arrows-rotate"></i>
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = lightboxImage; a.download = 'smart-messenger-image.png'; a.click(); }}
                style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'white', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}
                title="Download"
              >
                <i class="fa-solid fa-download"></i>
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); setLightboxImage(null); setLightboxZoom(1); setLightboxPos({ x: 0, y: 0 }); }}
                style={{ background: 'rgba(255,70,70,0.25)', border: 'none', color: 'white', width: '36px', height: '36px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}
                title="Close"
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
          {/* The image itself */}
          <div 
            style={{ overflow: 'auto', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={lightboxImage} 
              alt="Full View" 
              style={{ 
                transform: `scale(${lightboxZoom})`, 
                transition: 'transform 0.2s ease', 
                maxWidth: lightboxZoom <= 1 ? '90vw' : 'none', 
                maxHeight: lightboxZoom <= 1 ? '80vh' : 'none', 
                borderRadius: '12px', 
                boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
                objectFit: 'contain',
                cursor: lightboxZoom > 1 ? 'grab' : 'zoom-in'
              }} 
              onClick={(e) => { e.stopPropagation(); setLightboxZoom(z => z >= 2 ? 1 : z + 0.5); }}
              draggable={false}
            />
          </div>
        </div>
      )}

    </main>
  );
}
