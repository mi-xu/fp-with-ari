-- 1. Implement [foldable]toList : Foldable f => f a -> List a
foldMap : Foldable f => Monoid m => (a -> m) -> f a -> m
toList : Foldable f => f a -> List a
-- m = List a
toList fa = foldMap (\a => [a]) fa
toList = foldMap (\a => a:[])
toList = foldMap (:[]) -- "point-free" (don't reference vars by name)
-- [a] = (cons a []) = (a:[]) = ListPure

-- 2. Implement isEmpty using foldMap and OrBool

foldMap: Monoid b => Foldable f => (a -> b) -> f a -> b
record OrBool where
  constructor MkOrBool
  getBool : Bool
implementation Prelude.Semigroup OrBool where
  (MkOrBool b1) <+> (MkOrBool b2) = MkOrBool (b1 || b2)
implementation Prelude.Monoid OrBool where
  neutral = MkOrBool False

--

foldMap: Monoid b => Foldable f => (a -> b) -> f a -> b
isEmpty : Foldable f => f a -> bool
isEmpty fa = foldMap --: (a -> OrBool) -> f a -> OrBool
isEmpty fa = foldMap (\a => MkOrBool True) --: f a -> OrBool
isEmpty fa = foldMap (\a => MkOrBool True) fa --: OrBool
isEmpty fa = getBool (foldMap (\a => MkOrBool True) fa) --: Bool
isEmpty fa = (not (getBool (foldMap (\a => MkOrBool True) fa)))
-- point free
isEmpty fa = (not . getBool) (foldMap (\a => MkOrBool True) fa)
isEmpty fa = (not . getBool) ((foldMap (\a => MkOrBool True)) fa)
isEmpty fa = (not . getBool . (foldMap (\a => MkOrBool True))) fa
isEmpty = (not . getBool . (foldMap (\a => MkOrBool True)))
isEmpty = not . getBool . (foldMap (const (MkOrBool True)))
isEmpty = not . getBool . ((foldMap . const . MkOrBool) True)
-- what's up with this pattern of
-- lifting something into a structure,
-- doing some stuff
-- then getting it back out?
-- pure map extract
-- applicatives:pure :: coapplicatives:extract

foldMap (\a => MkOrBool True) : f a -> b
-- as : F a
foldMap (\a => MkOrBool True) as : b
-- b : OrBool
getBool (foldMap (\a => MkOrBool True) as) : Bool
-- since neutral is false, any elements make it true
isEmpty as = ((==) False (getBool (foldMap (\a => MkOrBool True) as)))

---

-- 3 Canonical Binders:

-- lambda: \{binder} => {body}
-- constructs a function instance

Nil : (A:Type) -> List A
-- pi: \{binder} -> {body}
-- constructs a function signature

-- a new scope is being opened every time you do let
-- let {binder} = {value} in {body}
let x : Nat = Z in
  x + x

-- "let" is isomorphic to a lambda application

---

-- "beta-substitution/reduction" (lambda calculus)
(\x:Nat => x + x) Z -- beta-redux "thing waiting to be beta-reduced"
(x + x)[x/Z] -- "/" = "replaced by"
Z + Z

---

-- "alpha-reduction" (lambda calculus)
\x => f x
f
-- "alpha-expansion"
f
\x => f x

-- 3. What do pure and apply do for:
Applicative f
  pure : a -> f a
  (<*>) : f (a -> b) -> f a -> f b

{-
Promise
  map: wait, call the function
  pure: take a thing and give it zero moments later (cast now to later) (how late? immediately)
  apply: take a function later that can transform a to b, then take a value a later, and eventually get a value b

List
  map: turn a list of one thing into a list of another by calling a function
  pure: put a thing into a list with only 1 element. makes a unit(al) list
  apply: given a list of functions and a list of things, apply each function to each thing to get a flattened list of all the possible combinations
    monoidal combine makes all the pairs, applicatives call the pairs to apply them

Maybe
  map: turn a thing into another thing if it's there
  pure: take a thing and give just it
  apply: given maybe a function and a thing, pass the thing through the function only if they both exist
    monoidal gives the function and the value if they're there, doesn't do the call
-}

-- 4. Implement traverse in terms of sequenceA and vice versa
interface Functor t => Foldable t => Traversable t where
  traverse : Applicative f => (a -> f b) -> t a -> f (t b)
  sequenceA : Applicative f => t (f a) -> f (t a)

f = Maybe
t = List
traverse : (a -> Maybe b) -> List a -> Maybe (List b)
sequenceA : List (Maybe a) -> Maybe (List a)
a = Int
b = String
traverse (x:Int -> y:Maybe String) : List Int -> Maybe (List String)
traverse (x:Int -> y:Maybe String) [1, 2, 3] : Maybe (List String)
traverse (x:Int -> y:Maybe String) [1, 2, 3] : Maybe (List String)
-- List (Maybe String)
traverse (x:Int -> y:Maybe String) [1, 2, 3] : Maybe (List String)
-- (x:Int -> y:Maybe String) [1, 2, 3] : ? -> List (Maybe String)
fmap (x:Int -> y:Maybe String) [1, 2, 3] : List (Maybe String)
traverse f as =  sequenceA fmap f as

Either (A ->Either B Unit) (B, A, (Either Void (A, B), Void))
Either (A ->Either B Unit) (B, A, (A*B, Void))