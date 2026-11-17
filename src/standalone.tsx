import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Proofgrid } from "@/components/proofgrid";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Proofgrid />
    </StrictMode>,
  );
}
