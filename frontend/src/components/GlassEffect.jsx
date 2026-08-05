"use client";
import React from "react";
import clsx from "clsx";

export const GlassEffect = ({
  children,
  className,
  style,
  href,
  target = "_blank",
}) => {
  const Wrapper = href ? "a" : "div";

  return (
    <Wrapper
      href={href}
      target={href ? target : undefined}
      rel={href ? "noopener noreferrer" : undefined}
      className={clsx(
        "relative overflow-hidden cursor-pointer transition-all duration-700",
        className
      )}
      style={{
        boxShadow:
          "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.45)",
        transitionTimingFunction: "cubic-bezier(0.175, 0.885, 0.32, 2.2)",
        ...style,
      }}
    >
      {/* Liquid glass base */}
      <div
        className="absolute inset-0 rounded-inherit"
        style={{
          backdropFilter: "blur(14px) saturate(160%)",
          WebkitBackdropFilter: "blur(14px) saturate(160%)",
          filter: "url(#glass-distortion)",
          isolation: "isolate",
        }}
      />

      {/* Tint */}
      <div
        className="absolute inset-0 rounded-inherit"
        style={{ background: "rgba(255,255,255,0.25)" }}
      />

      {/* Edge highlight */}
      <div
        className="absolute inset-0 rounded-inherit pointer-events-none"
        style={{
          boxShadow:
            "inset 1px 1px 1px rgba(255,255,255,0.5), inset -1px -1px 1px rgba(255,255,255,0.35)",
        }}
      />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </Wrapper>
  );
};
