import { useMemo } from "react";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";

type CodeEditorProps = {
  height: string;
  language: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  readOnly?: boolean;
};

export default function CodeEditor({ height, language, value, onChange, readOnly }: CodeEditorProps) {
  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      wordWrap: "on",
      minimap: { enabled: false },
      readOnly,
    }),
    [readOnly]
  );

  return (
    <Editor
      height={height}
      language={language}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}
