"use client";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    // global-error must include html and body tags
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#0a0612",
            color: "#f4f1fa",
            fontFamily:
              "var(--font-geist-sans), Arial, Helvetica, sans-serif",
            textAlign: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "80px",
              height: "80px",
              borderRadius: "24px",
              background:
                "linear-gradient(135deg, #9333ea, #c026d3)",
              boxShadow: "0 20px 40px rgba(88, 28, 135, 0.4)",
              fontSize: "30px",
            }}
          >
            💬
          </div>
          <h2 style={{ marginTop: "24px", fontSize: "20px" }}>
            Something went wrong!
          </h2>
          <p style={{ marginTop: "8px", color: "#a1a1aa", fontSize: "14px" }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={retry}
            style={{
              marginTop: "24px",
              padding: "10px 20px",
              borderRadius: "12px",
              border: "none",
              background:
                "linear-gradient(90deg, #9333ea, #c026d3)",
              color: "white",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error && error.message && (
            <p
              style={{
                marginTop: "16px",
                color: "#71717a",
                fontSize: "12px",
                maxWidth: "400px",
                wordBreak: "break-word",
              }}
            >
              {error.message}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}