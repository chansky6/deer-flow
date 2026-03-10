export function getBackendBaseURL() {
  return "/bff";
}

export function getLangGraphBaseURL(isMock?: boolean) {
  if (isMock) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/mock/api`;
    }
    return "http://localhost:3000/mock/api";
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}/bff/api/langgraph`;
  }
  return "http://localhost:3000/bff/api/langgraph";
}
