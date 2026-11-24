import React from "react"
import ReactDOM from "react-dom/client"
import { ParentsApp } from "./ParentsApp"
import "./parents.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ParentsApp />
  </React.StrictMode>,
)

// Instalavel na tela inicial (Android/Chrome); no iPhone usa "Adicionar a Tela de Inicio".
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/pais/sw.js", { scope: "/pais/" }).catch(() => undefined)
  })
}
