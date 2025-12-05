'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface CssEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
}

export default function CssEditor({ 
  value, 
  onChange, 
  height = '300px',
  readOnly = false 
}: CssEditorProps) {
  const [themeVersion, setThemeVersion] = useState(0);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  // Detect if the current theme is light or dark based on background color
  const isDarkTheme = useCallback(() => {
    if (typeof window === 'undefined') return true;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
    // Convert hex to RGB and calculate luminance
    const hex = bg.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5;
  }, []);

  const updateEditorTheme = useCallback(() => {
    if (!monacoRef.current) return;

    const monaco = monacoRef.current;
    
    // Get CSS variables from the current theme
    const computedStyle = getComputedStyle(document.documentElement);
    const background = computedStyle.getPropertyValue('--background').trim();
    const foreground = computedStyle.getPropertyValue('--foreground').trim();
    const border = computedStyle.getPropertyValue('--border').trim();
    const primary = computedStyle.getPropertyValue('--primary').trim();
    const secondary = computedStyle.getPropertyValue('--secondary').trim();
    const muted = computedStyle.getPropertyValue('--muted').trim();
    const mutedForeground = computedStyle.getPropertyValue('--muted-foreground').trim();

    // Define a custom theme based on the current app theme
    monaco.editor.defineTheme('appTheme', {
      base: isDarkTheme() ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: mutedForeground.replace('#', '') },
        { token: 'keyword', foreground: primary.replace('#', ''), fontStyle: 'bold' },
        { token: 'string', foreground: primary.replace('#', '') },
      ],
      colors: {
        'editor.background': background,
        'editor.foreground': foreground,
        'editor.lineHighlightBackground': secondary,
        'editorLineNumber.foreground': mutedForeground,
        'editorLineNumber.activeForeground': foreground,
        'editor.selectionBackground': primary + '40',
        'editor.inactiveSelectionBackground': primary + '20',
        'editorCursor.foreground': primary,
        'editorWhitespace.foreground': border,
        'editorIndentGuide.background': border,
        'editorIndentGuide.activeBackground': mutedForeground,
        'editorWidget.background': secondary,
        'editorWidget.border': border,
        'editorSuggestWidget.background': secondary,
        'editorSuggestWidget.border': border,
        'editorSuggestWidget.foreground': foreground,
        'editorSuggestWidget.selectedBackground': muted,
        'input.background': background,
        'input.border': border,
        'input.foreground': foreground,
        'focusBorder': primary,
        'list.activeSelectionBackground': primary + '40',
        'list.hoverBackground': muted,
        'list.inactiveSelectionBackground': muted,
      },
    });

    // Apply the custom theme
    monaco.editor.setTheme('appTheme');
  }, [isDarkTheme]);

  const handleEditorDidMount = useCallback((editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    updateEditorTheme();
  }, [updateEditorTheme]);

  // Watch for theme changes by listening to custom event
  useEffect(() => {
    const handleThemeChange = () => {
      setThemeVersion(v => v + 1);
      // Use setTimeout to ensure CSS variables are updated
      setTimeout(() => {
        updateEditorTheme();
      }, 0);
    };

    window.addEventListener('themeChanged', handleThemeChange);

    return () => {
      window.removeEventListener('themeChanged', handleThemeChange);
    };
  }, [updateEditorTheme]);

  // Update theme when themeVersion changes
  useEffect(() => {
    if (themeVersion > 0) {
      updateEditorTheme();
    }
  }, [themeVersion, updateEditorTheme]);

  return (
    <Editor
      height={height}
      defaultLanguage="css"
      value={value}
      onChange={(value) => onChange(value || '')}
      theme="vs-dark"
      onMount={handleEditorDidMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        roundedSelection: false,
        scrollBeyondLastLine: false,
        readOnly,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        suggest: {
          showKeywords: true,
          showSnippets: true,
        },
      }}
    />
  );
}
