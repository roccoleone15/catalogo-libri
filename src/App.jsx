import React, { useEffect, useRef, useState } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import { BrowserMultiFormatReader } from "@zxing/browser";

/** ====== CONFIG ====== */
// Endpoint (deployment "Web app" di Google Apps Script, quello che termina con /exec)
const ENDPOINT =
  "https://script.google.com/macros/s/AKfycbyKdL1AoXQm2Ybe3i6xojoq3ovU-WqpUximmnT7bdnCERlak4HqN-CqmmCCXBlfq2nWjA/exec";

// Client ID OAuth (quello che mi hai dato)
const GOOGLE_CLIENT_ID =
  "913870968625-a9ocd6aj71q1mpraccgmq5r25vapnlgh.apps.googleusercontent.com";

/** ====== UI helper ====== */
function Btn({ children, ghost, onClick, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ghost ? "#fff" : "#2563eb",
        color: ghost ? "#111" : "#fff",
        padding: "12px 16px",
        borderRadius: 12,
        border: ghost ? "1px solid #ddd" : "none",
        boxShadow: ghost ? "none" : "0 2px 8px rgba(0,0,0,0.1)",
        width: 260,
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** ====== SCANNER ====== */
function Scanner({ boxName, onDone }) {
  const videoRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState("");
  const [reader] = useState(() => new BrowserMultiFormatReader());
  const stopFnRef = useRef(null);

  // anti-duplicato
  const recentCodesRef = useRef(new Map()); // code -> timestamp
  const COOLDOWN_MS = 6000;   // ignora lo stesso codice per 6s
  const GLOBAL_RATE_MS = 500; // distanza minima tra due letture qualsiasi
  const lastAnyScanRef = useRef(0);

  const beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      setTimeout(() => o.stop(), 150);
    } catch {}
  };

  // invia solo ISBN validi (10 o 13 con 978/979)
  const sendToSheet = async (raw) => {
    const digits = String(raw || "").replace(/\D+/g, "");
    const isIsbn =
      digits.length === 10 ||
      (digits.length === 13 && (digits.startsWith("978") || digits.startsWith("979")));
    if (!isIsbn) return;

    try {
      await fetch(ENDPOINT, {
        method: "POST",
        // con Apps Script spesso mancano le CORS headers → usiamo no-cors
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ box: boxName, isbn: digits }),
      });
    } catch {
      // è normale non avere risposta con no-cors
    }
  };

  const sweepOld = (now) => {
    for (const [code, t] of recentCodesRef.current.entries()) {
      if (now - t > COOLDOWN_MS) recentCodesRef.current.delete(code);
    }
  };

  const start = async () => {
    if (running) return;
    setRunning(true);
    try {
      stopFnRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result) => {
          if (!result) return;
          const now = Date.now();

          // rate limit globale
          if (now - lastAnyScanRef.current < GLOBAL_RATE_MS) return;
          lastAnyScanRef.current = now;

          const raw = (result.getText() || "").trim();
          if (!raw) return;

          // dedup per codice
          sweepOld(now);
          if (recentCodesRef.current.has(raw)) return;

          recentCodesRef.current.set(raw, now);
          setLast(raw);
          setCount((c) => c + 1);
          beep();
          sendToSheet(raw);
        }
      );
    } catch (e) {
      alert("Impossibile avviare la fotocamera. Concedi i permessi al browser e riprova.");
      setRunning(false);
    }
  };

  const stop = () => {
    try { stopFnRef.current?.stop(); } catch {}
    reader.reset();
    setRunning(false);
  };

  useEffect(() => () => stop(), []);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
        Scansione attiva per: {boxName}
      </h2>

      <div style={{ marginBottom: 12 }}>
        {!running ? (
          <Btn onClick={start} style={{ width: 300 }}>Avvia scansione</Btn>
        ) : (
          <Btn ghost onClick={stop} style={{ width: 300 }}>Ferma scansione</Btn>
        )}
      </div>

      <video
        ref={videoRef}
        style={{
          width: "100%", maxWidth: 640,
          borderRadius: 12, border: "1px solid #ddd", background: "#000"
        }}
        muted playsInline
      />

      <div style={{ marginTop: 12, color: "#555" }}>
        <div>Letti: <strong>{count}</strong></div>
        <div>Ultimo codice letto: <strong>{last || "—"}</strong></div>
        <div style={{ fontSize: 12, marginTop: 6 }}>
          Suggerimento: allontana il libro dopo il beep ✅
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Btn ghost onClick={onDone}>Torna alla Home</Btn>
      </div>
    </div>
  );
}

/** ====== APP ROOT ====== */
export default function App() {
  const [user, setUser] = useState(null);
  const [boxName, setBoxName] = useState("");
  const [step, setStep] = useState("home");
  const [sheets, setSheets] = useState([]);

  const handleLoginSuccess = (credentialResponse) => {
    setUser({ token: credentialResponse.credential });
  };

  const handleStartScan = () => {
    if (!boxName.trim()) {
      alert("Inserisci il nome della scatola (es. Scatola1)");
      return;
    }
    setStep("scanner");
  };

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <main style={{ minHeight: "100vh", background: "#fff", padding: 24 }}>
        {step === "home" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              alignItems: "center",
            }}
          >
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Catalogo Libri 📚</h1>
            {!user ? (
              <GoogleLogin
                onSuccess={handleLoginSuccess}
                onError={() => alert("Errore login Google")}
              />
            ) : (
              <>
                <Btn onClick={() => setStep("start")}>Inizia Scansione</Btn>
                <Btn ghost onClick={() => setStep("liste")}>
                  Visualizza Liste
                </Btn>
                <Btn ghost onClick={() => setStep("scatole")}>
                  Scatole Create
                </Btn>
              </>
            )}
          </div>
        )}

        {step === "start" && (
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
              Inserisci nome scatola
            </h2>
            <input
              type="text"
              value={boxName}
              onChange={(e) => setBoxName(e.target.value)}
              placeholder="Es. Scatola1"
              style={{
                width: "100%",
                padding: 10,
                border: "1px solid #ddd",
                borderRadius: 8,
                marginBottom: 12,
              }}
            />
            <Btn onClick={handleStartScan}>Avvia Scansione</Btn>
          </div>
        )}

        {step === "scanner" && (
          <Scanner boxName={boxName} onDone={() => setStep("home")} />
        )}

        {step === "liste" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
              Liste Registrate
            </h2>
            {/* TODO: collegare lettura dallo Sheet */}
            <ul>{sheets.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}

        {step === "scatole" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
              Scatole Create
            </h2>
            {/* TODO: collegare lettura dallo Sheet */}
            <ul>
              <li>Scatola1</li>
              <li>Scatola2</li>
            </ul>
          </div>
        )}
      </main>
    </GoogleOAuthProvider>
  );
}
