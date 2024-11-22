/*
1.
  traverse: (Traversable t, Applicative f) => (a -> f b) -> t a -> f (t b)

In traverse fill in t and f with a few different examples and think through what it does.
  Goal: really digest the ideal of "monoidally combining" the contexts.

Traversables
- List
- Maybe
- Either
- Tree
- Map

Applicatives
- List
- Maybe
- Promise
- Const
- Stream

t = List
(a -> List b) -> List a -> List (List b)          f = List
(a -> Maybe b) -> List a -> Maybe (List b)        f = Maybe
takes a function that turns a to maybe b, and a list of a
combines each maybe into a list of maybes
(a -> Promise b) -> List a -> Promise (List b)    f = Promise
(a -> Const b) -> List a -> Const (List b)        f = Const
(a -> Stream b) -> List a -> Stream (List b)      f = Stream

t = Maybe
(a -> List b) -> Maybe a -> List (Maybe b)          f = List
(a -> Maybe b) -> Maybe a -> Maybe (Maybe b)        f = Maybe
(a -> Promise b) -> Maybe a -> Promise (Maybe b)    f = Promise
(a -> Const b) -> Maybe a -> Const (Maybe b)        f = Const
(a -> Stream b) -> Maybe a -> Stream (Maybe b)      f = Stream

t = Either
(a -> List b) -> Either a -> List (Either b)          f = List
(a -> Maybe b) -> Either a -> Maybe (Either b)        f = Maybe
(a -> Promise b) -> Either a -> Promise (Either b)    f = Promise
(a -> Const b) -> Either a -> Const (Either b)        f = Const
(a -> Stream b) -> Either a -> Stream (Either b)      f = Stream

t = Tree
(a -> List b) -> Tree a -> List (Tree b)          f = List
(a -> Maybe b) -> Tree a -> Maybe (Tree b)        f = Maybe
(a -> Promise b) -> Tree a -> Promise (Tree b)    f = Promise
(a -> Const b) -> Tree a -> Const (Tree b)        f = Const
(a -> Stream b) -> Tree a -> Stream (Tree b)      f = Stream

t = Map
(a -> List b) -> Map a -> List (Map b)          f = List
(a -> Maybe b) -> Map a -> Maybe (Map b)        f = Maybe
(a -> Promise b) -> Map a -> Promise (Map b)    f = Promise
(a -> Const b) -> Map a -> Const (Map b)        f = Const
(a -> Stream b) -> Map a -> Stream (Map b)      f = Stream

- Light touchpoint between traversable and applicative.
- Loose couplings on purpose because we try to abstract and make things polymorphic.
- Type algebras tell you very little about the thing.

       type algebra  interface
       |             |
loose--+-------------+----------tight (coupling)
high                            low   (abstraction)

- Methods that interact with a Socket usually don't need to know the full interface
- Identify when code can use the minimal abstraction possible
- Abstraction != Detail Hiding. Writing an interface is more about hiding details to decouple implementation details. Not abstracting.
  - Abstraction: Socket = Promise & ... & ..., barely need to write any socket code
  - Abstraction: -concrete detail, +generality
- Traverse is expressing minimal connection between sequencing and applicative
  - Applicative is about being able to combine the *contexts*
*/

/*
2. Consider:
  getChar : StdInIO Char         // block on stdin to get a byte (mutates stdin, dequeu the byte)
  putChar : Char -> StdOutIO ()  // stdout
    () Unit is zero-element tuple
    IO is an operation that mutates the world
    IO FileIO StdInIO ... more specific effects let you reason about their safety

  Now imagine you want to get 5 chars from the user. Can you model that with traverse?
    It's ok if you use words instead of code. Goal: understand how traverse relates to this.

  Hint: what is the type of the next expression:
    [getChar, getChar, getChar, getChar, getChar] : List (IO Char)
  We want IO (List Char)

  traverse :: (Traversable t, Applicative f) => (a -> f b) -> t a -> f (t b)
  sequenceA :: (Traversable t, Applicative f) => t (f a) -> f (t a)

  sequenceA [getChar, getChar, getChar, getChar, getChar] : IO (List Char)
    this is List's sequenceA

  traverse :: (IO Char -> IO Char) -> List (IO Char) -> IO (List Char)
  f : IO
  id : (IO Char -> IO Char)
  traverse id [getChar, getChar, getChar, getChar, getChar] : IO (List Char)

  sequenceA = traverse id

  traverse afb ta = sequenceA : t (f b) -> f (t b)
  map afb ta : t (f b)
  traverse afb ta = sequenceA (map afb ta) : f (t b)
    try to get 2 things out from map to make it point free
    need 2 .s

  make it point free?
  traverse = (sequenceA . map)
  traverse afb ta = (sequenceA . map) afb ta
  traverse afb ta = (sequenceA (map afb)) ta
    no

  traverse afb = \x -> sequenceA (map afb x)
  traverse afb = sequenceA . (map afb)
  traverse = \x -> sequenceA . (map x)
    traverse = \x -> ((.) sequenceA) (map x)
    (+) 3 4
    ((+) 3) 4
    (3 +) 4
  traverse = \x -> (sequenceA .) (map x)
  traverse = (sequenceA .) . map
    composition of 2 functions, just a function
    give it a thing
    call map
    then call (sequenceA .)
    sequenceA applied to map, applied to 2 arguments

  (sequenceA (map afb))
  (sequenceA .) . map

  functions with . is a Monoid
  mempty = id
*/

/*
3. Think or prove if all traversables are foldable? meaning can you get foldMap from traverse? Or not?

traverse :: (Traversable t, Applicative f) => (a -> f b) -> t a -> f (t b)
foldMap :: (Foldable t, Monoid m) => (a -> m) -> t a -> m

foldable restricts traversable

(a -> f b) -> t a -> f (t b)
(a -> m)   -> t a -> m

f b -> f (t b) -> f (t b)
m   -> m       -> m

traversable is also applicative, so it has a pure
go inside the f and t pure the b
now you have 2 applicatives f (t b), f (t b)
applicative is monoidal
use f's monoidal combine
(*&*) : F a -> F b -> F (a, b)
f ((t b), (t b))

foldMap a2m ta = _ : m
foldMap a2m ta = traverse _ ta : f (t b)
  we want an m
  f (t b) is an m
    What f should we use?
    Const m
    Const is binary, Const m is unary
    Const m (t b) is a type
    Const m (t b) = m
foldMap a2m ta = traverse (_ : a -> f b) ta : f (t b)
  f : Const m
foldMap a2m ta = traverse (_ : a -> Const m b) ta : Const m (t b)
foldMap a2m ta = traverse (_ : a -> m) ta : m
  a2m : a -> m
foldMap a2m ta = traverse a2m ta
  Traversable t =>
  Monoid m =>
  Applicative Const m =>
foldMap = traverse

Const function != Const type
What does Const m do to be meaningful?
*/
