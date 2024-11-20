/*
LAWS

apply(pure(f), pure(a)) == pure(f(a))
apply(pure(f), pure(a)) == pure(funcApply(f,a))
apply outside, pures inside <=> pure outside funcApply inside
<*>: (f(a -> b), f a) -> f b
algebraic framing: relationship between things, symbolic swapping
"adjoint"
apply is funcApply's "adjoint"

if pure is identity:
apply(f, a) == funcApply(f, a)
*/

/*
"effect" is a particular kind of context
*/

// promise: laterness, deferment
// pure
const purePromise = <A>(a: A): Promise<A> => Promise.resolve(a);
const purePromise_ = Promise.resolve;
// <*>
const applyPromise = <A, B>(
  Ff: Promise<(a: A) => B>,
  Fa: Promise<A>
): Promise<B> => Ff.then((f) => Fa.then((a) => f(a)));
// ...perf optimized => Promise.all([Ff, Fa]).then(([f, a]) => f(a));
// law
// apply(f, a) == pure(f(a))
const f = (a: string) => a.length;
const Ff = purePromise(f);
const a = "five";
const Fa = purePromise(a);
const x = applyPromise(Ff, Fa);
const y = purePromise(f(a));
// x == y
// functor application == applicative's apply
// functor application on lifted args == lifted (function application of args)

// maybe
// pure
const pureMaybe = <A>(a: A): A | undefined => a;
// <*>
const applyMaybe = <A, B>(
  Ff: ((a: A) => B) | undefined,
  Fa: A | undefined
): B | undefined =>
  Ff !== undefined ? (Fa !== undefined ? Ff(Fa) : undefined) : undefined;
// ...js syntax => Fa ? Ff?.(Fa) : undefined;
// ...optimized => (Ff === undefined || Fa === undefined ? undefined : Ff(Fa));

// list
// pure
const pureList = <A>(a: A): A[] => [a];
// <*>
const applyList = <A, B>(Ff: ((a: A) => B)[], Fa: A[]): B[] =>
  Fa.flatMap((a) => Ff.map((f) => f(a)));
// ...also => Ff.flatMap((f) => Fa.map((a) => f(a)));

// const zip = <A, B>(Ff: ((a: A) => B)[], Fa: A[]): B[] =>
// if A is a Monoid, Fa can fill defaults with identity
// if B is a Monoid, Ff can fill defaults with identity

// _ -> string (not Reader)
// Claim: A implements toString()
// pure
const pureStr =
  <A>(a: A): ((x: A) => string) =>
  (aa: A) =>
    "";
// <*>
const applyStr =
  <A, B>(
    Ff: (a: (x: A) => B) => string,
    Fa: (x: A) => string
  ): ((x: B) => string) =>
  () =>
    "";

// string -> _ (Reader_String)
// pure
const pureReaderString =
  <A>(a: A): ((x: string) => A) =>
  (_: string) =>
    a;
const applyReaderString =
  <A, B>(
    Ff: (s: string) => (a: A) => B,
    Fa: (s: string) => A
  ): ((s: string) => B) =>
  (s: string) =>
    Ff(s)(Fa(s));
// (.)functionPair([Ff, Fa],[s, s])
// (Ff, s) . (Fa, s)

// functionPair((Ff, Fa), (s, s))
const functionPair = <A, D>(
  [Ff, Fa]: [(as: [A, A]) => D, (a: A) => D],
  a: A
): [(a: A) => D, A] => [Ff([a, a]), Fa(a)];
