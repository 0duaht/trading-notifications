export function getCurrentTime(): string {
  return new Date().toString();
}

// This will be used on the client side to get the user's local time
export function getUserTime(): string {
  return new Date().toString();
} 
