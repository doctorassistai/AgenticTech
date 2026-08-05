import React from "react"

export function DarkGradientBg({ children, className = "" }) {
  return (
    <div
      className={`relative min-h-screen w-full bg-black overflow-hidden ${className}`}
    >
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 opacity-100"
          style={{
            background:
              "radial-gradient(100% 100% at 0% 0%, rgb(46, 46, 46) 0%, rgb(0, 0, 0) 100%)",
            mask:
              "radial-gradient(125% 100% at 0% 0%, rgb(0, 0, 0) 0%, rgba(0, 0, 0, 0.224) 88.2883%, rgba(0, 0, 0, 0) 100%)",
          }}
        >
          {/* Skewed blue streaks */}
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="absolute inset-0 opacity-20"
              style={{
                background:
                  "linear-gradient(rgb(0, 207, 255) 0%, rgba(0, 207, 255, 0) 100%)",
                transform: "skewX(45deg)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Noise texture */}
      <div
        className="absolute inset-0 opacity-5 bg-repeat"
        style={{
          backgroundImage:
            'url("https://framerusercontent.com/images/6mcf62RlDfRfU61Yg5vb2pefpi4.png")',
          backgroundSize: "149.76px",
        }}
      />

      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Radial highlight */}
      <div className="absolute inset-0 bg-gradient-radial from-slate-800/20 via-transparent to-transparent" />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  )
}
