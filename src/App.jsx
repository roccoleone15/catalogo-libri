import React, { useState } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";

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
      alert("Inserisci il nome della scatola");
      return;
    }
    setStep("scanner");
  };

  const Btn = ({ children, ghost, onClick }) => (
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
      }}
    >
      {children}
    </button>
  );

  return (
    <GoogleOAuthProvider clientId="913870968625-a9ocd6aj71q1mpraccgmq5r25vapnlgh.apps.googleusercontent.com">
      <main style={{ minHeight: "100vh", background: "#fff", padding: 24 }}>
        {step === "home" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>Catalogo Libri 📚</h1>
            {!user ? (
              <GoogleLogin onSuccess={handleLoginSuccess} onError={() => alert("Errore login Google")} />
            ) : (
              <>
                <Btn onClick={() => setStep("start")}>Inizia Scansione</Btn>
                <Btn ghost onClick={() => setStep("liste")}>Visualizza Liste</Btn>
                <Btn ghost onClick={() => setStep("scatole")}>Scatole Create</Btn>
              </>
            )}
          </div>
        )}

        {step === "start" && (
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Inserisci nome scatola</h2>
            <input
              type="text"
              value={boxName}
              onChange={(e) => setBoxName(e.target.value)}
              placeholder="Es. Scatola1"
              style={{ width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 8, marginBottom: 12 }}
            />
            <Btn onClick={handleStartScan}>Avvia Scansione</Btn>
          </div>
        )}

        {step === "scanner" && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
              Scansione attiva per: {boxName}
            </h2>
            <p style={{ color: "#666" }}>[Qui integreremo fotocamera + OCR + invio a Google Sheets]</p>
          </div>
        )}

        {step === "liste" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Liste Registrate</h2>
            <ul>
              {sheets.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {step === "scatole" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Scatole Create</h2>
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
