import { createContext, useContext } from "react";

export const MactCtx = createContext(null);
export const useMact = () => useContext(MactCtx);