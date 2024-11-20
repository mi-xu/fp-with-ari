{-
Functor
- unary (1-ary) type constructor
  - F <name>
  - F List _, List String
- fmap: a -> b -> F a -> F b
- 2 laws
  - identity: fmap x = x
  - composition: fmap (f . g) = fmap f . fmap g
- Rigorous definition: Functor is a pair (unary type constructor, fmap implementation)
  - In Idris: you can define a type Functor AND write code that proves the 2 laws
  - In Haskell: you can define a type Functor, but you have to prove the 2 laws manually (verify with your eyeballs)
  - In Typescript: you cannot define the Functor type. You can define a type that IS Functor (ex: Array).

Functors "wrap" data inside, and embody some concept
They "lift" some type into a "context"

function fmapArray(f: (a:A) => B, as: A[]): bs: B[] {
  return as.map(b)
  // OR
  const result = []
  for(const a of as) {
    result.push(f(a))
  }
  return result
}

- fmap: (a -> b) -> F a -> F b
function fmapPromise(f: (a: A) => B, pa: Promise<A>): Promise<B> {
  // resolve?
  // Promise.resolve()
  return pa.then(f)
  // .then IS the fmap for Promise functor
  // caveat: .then is also the .chain of Promise because ts is fucked up
}

type Maybe<T> = { value: T } | None
function isSome<T>(m: Maybe<T>): m is Some<T> { ... }
function isNone<T>(m: Maybe<T>): m is None { ... }
function some<T>(t:T): Maybe<T> { ... }
function none(): None { ... }
function fmapMaybe(f: (a: A) => B, ma: Maybe<A>): Maybe<B> {
  if(isSome(ma)) {
    return some(f(ma.value))
  } else {
    return none()
  }
}

---

functor laws
identity: fmap x = x
composition: fmap (f . g) = fmap f . fmap g

if you have:
  - some function id : x -> x
  - an instance of F a
fmap :: a -> b -> F a -> F b
fmap id :: F a -> F b
fmap id [1] :: F b
F b = [1]
calling (fmap id) on (F a) gives you back (F a)
if the function you pass into fmap is identity, the Functor should not be doing anything to the value inside
The Functor is not adding any extra behaviors when mapping

---

Type: thing that can have instances
  - a 0-ary type constructor
Type Constructor:
  - arity (number of holes)
  - List _ is a 1-ary type constructor
  - You can't have an instance of List _
  - Pair _ _ is a 2-ary type constrcutor

function foo(a: A): B { }
const foo = (a: A) => B
(a: A) => B
(A) => B
A => B
A -> B

Currying
- function takes another function as an argument
- function passes it along
- two functions having sex

- partial application
- calling a function that has multiple arguments, with one of the arguments filled in, getting another function back out that does the same thing but takes one less argument
- fixing an argument

foo(a: A, b: B) => C
foo'(b: B) => foo(1, b) => C

- default arg is probably related to currying somewhat, but more of a language-specific implementation detail than relating directly at the type theory level
foo(a: A, b: B, c: number = 37) => D
foo(x, y)

(A, B) -> C
A -> (B -> C)
(A -> B) -> C
A -> B -> C

([A, B, C]) -> D
(A, B, C) -> D
A -> B -> C -> D

 -}
