import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/** The signed-in user (the Shell guarantees one on app pages). */
export function useMe() {
  const q = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, staleTime: 60_000 });
  return q.data?.user;
}
