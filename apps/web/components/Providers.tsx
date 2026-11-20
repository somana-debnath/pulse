"use client";
import { MotionConfig } from "framer-motion";

// reducedMotion="user": Framer Motion skips transform/layout animations when the OS asks for reduced motion.
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
