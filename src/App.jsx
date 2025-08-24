import React, { useEffect, useRef, useState } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import { BrowserMultiFormatReader } from "@zxing/browser";

// Webhook Apps Script che scrive sullo Sheet (finisce con /exec)
const WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbxZviwyFCkbCOqtbuDYOdiGjuy3ak7WJiL3dqZfAvcltxl34BdQ2UG1t0LP9rV04tVh3g/exec";

// ID client OAuth Google (quello che mi hai fornito)
const GOOGLE_CLIENT_ID =
  "913870968625-a9ocd6aj71q1mpraccgmq5r25vapnlgh.apps.googleusercontent.com";

// Button di stile semplice
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

// Componente Scanner con lettura continua
function Scanner({ boxName, onDone }) {
  const videoRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState("");
  const [reader] = useState(() => new BrowserMultiFormatReader());
  const lastSentRef = useRef("");
  const stopFnRef = useRef(null);

  // beep ogni lettura
  const beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = 880;
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      setTimeout(() => o.stop(), 150);
    } catch {}
  };

  // invio al foglio via Apps Script (no-cors: non aspettiamo risposta)
  const sendToSheet = async (isbn) => {
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ box: boxName, isbn }),
      });
    } catch {
      // con no-cors è normale non vedere risposta
    }
  };

  const start = async () => {
    if (running) return;
    setRunning(true);
    try {
      stopFnRef.current = await reader.decodeFromVideoDevice(
        undefined, // lascia scegliere la camera "best"
        videoRef.current,
        async (result, err) => {
          if (result) {
            const raw = (result.getText() || "").trim();
            // evita doppie letture ravvicinate dello stesso codice
            if (raw && raw !== lastSentRef.current) {
              lastSentRef.current = raw;
              setLast(raw);
              setCount((c) => c + 1);
              beep();
              sendToSheet(raw);
              // sblocca la possibilità di rileggere lo stesso codice dopo 1.5s
              setTimeout(() => {
                lastSentRef.current = "";
              }, 1500);
            }
          }
        }
      );
    } catch (e) {
      alert(
        "Impossibile avviare la fotocamera.\nConcedi i permessi al browser e riprova."
      );
      setRunning(false);
    }
  };

  const stop = () => {
    try {
      stopFnRef.current?.stop();
    } catch {}
    reader.reset();
    setRunning(false);
  };

  useEffect(() => {
    // stop su smontaggio
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
        Scansione attiva per: {boxName}
      </h2>

      <div style={{ marginBottom: 12 }}>
        {!running ? (
          <Btn onClick={start} style={{ width: 300 }}>
            Avvia scansione
          </Btn>
        ) : (
          <Btn ghost onClick={stop} style={{ width: 300 }}>
            Ferma scansione
          </Btn>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <video
          ref={videoRef}
          style={{
            width: "100%",
            maxWidth: 640,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "#000",
          }}
          muted
          playsInline
        />
      </div>

      <div style={{ marginTop: 12, color: "#555" }}>
        <div>
          Letti: <strong>{count}</strong>
        </div>
        <div>
          Ultimo ISBN: <strong>{last || "—"}</strong>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Btn ghost onClick={onDone}>Torna alla Home</Btn>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [boxName, setBoxName] = useState("");
  const [step, setStep] = useState("home");
  const [sheets, setSheets] = useState([]); // placeholder per viste future

  const handleLoginSuccess = (credentialResponse) => {
    setUser({ token: credentialResponse.credential });
  };

  const handleStartScan = () => {
    if (!boxName.trim()) {
      alert("Inserisci il nome della scatola (solo caratteri/num. es. Scatola1)");
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
