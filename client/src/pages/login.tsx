import { LoginForm } from "@/components/auth/login-form";

interface LoginProps {
  onSuccess: (user: any) => void;
}

export function Login({ onSuccess }: LoginProps) {
  return <LoginForm onSuccess={onSuccess} />;
}
