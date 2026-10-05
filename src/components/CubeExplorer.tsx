"use client";

import { useEffect } from "react";
import { useCubeStore } from "@/lib/cube/store";
import { AxisPanel } from "./AxisPanel";
import { FaceTable } from "./FaceTable";
import styles from "./explorer.module.css";

export function CubeExplorer() {
  const init = useCubeStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <main className={styles.wrap}>
      <header>
        <h1 className={styles.title}>Cube Explorer</h1>
        <p className={styles.note}>行・列・奥行きの軸を選び、奥行きを集約するか断面で切るかを切り替えて面を見ます。</p>
      </header>
      <AxisPanel />
      <FaceTable />
    </main>
  );
}
