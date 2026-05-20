import { useCallback, useRef, useState } from "react";
import { parseHarJson } from "@htv/core/parsers/har-parser.js";
import type { ParsedHar } from "@htv/core/types.js";
import styles from "./DropZone.module.css";

interface Props {
  onLoad: (har: ParsedHar) => void;
}

export function DropZone({ onLoad }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      setError(null);
      if (!file.name.endsWith(".har")) {
        setError("Only .har files are supported.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const har = parseHarJson(text);
          onLoad(har);
        } catch {
          setError("Could not parse the HAR file. Make sure it's a valid Chrome DevTools HAR.");
        }
      };
      reader.readAsText(file);
    },
    [onLoad]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div
      className={`${styles.zone} ${isDragging ? styles.dragging : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Drop a HAR file or click to browse"
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".har"
        className={styles.input}
        onChange={handleChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className={styles.icon}>⬇</div>
      <div className={styles.primary}>Drop a .har file here</div>
      <div className={styles.secondary}>or click to browse</div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
