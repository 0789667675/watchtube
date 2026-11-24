import { Link, useLocation, type LinkProps } from 'react-router-dom';

type SignInLinkProps = Omit<LinkProps, 'to' | 'state'>;

export function SignInLink(props: SignInLinkProps) {
  const { pathname, search, hash } = useLocation();

  return (
    <Link
      {...props}
      to="/auth/login"
      state={{ from: { pathname, search, hash } }}
    />
  );
}
