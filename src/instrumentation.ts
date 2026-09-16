import type { Instrumentation } from "next";
import { reportFailure } from "./server/diagnostics";
export const onRequestError: Instrumentation.onRequestError = (error) => {
  reportFailure("server-render", error);
};
