-- 1. Think about: can you imagine a functor that is not foldable?
--   You could try enumerating functors and see if you find one...
--   IF all functors were foldable then you could implement foldMap from map...
--     Can you?
fmap :: Functor f => (a -> b) -> f a -> f b
foldMap :: Foldable f => Monoid m => (a -> m) -> f a -> m
-- can't implement foldMap from fmap
-- imagine a functor where if you gave it f : a -> m
-- and then an fa : f a
-- you can't get an m out of it
-- a functor that always eats the value inside?
-- Vanish?
-- Maybe A             : says "I am an A (footnote: maybe)".
-- Yes, Maybe is Foldable
-- Promise A           : an A (footnote: later)
-- Yes, you await the value and then convert it to m
-- Either A String     : an A (footnote: might actually be a String)
-- Yes, Either A can turn into m or string can become the empty
-- List A              : an A (footnote: after you tell me a valid index)
-- Obvi yes
-- (s: String) => A    : an A (footnote: that will be computed from the string you pass in)
-- *** Not foldable. You never have actual strings to turn into As.
-- (a: A) => Nat       : an A (footnote: waiting to be received to turn into a Nat) NOTE: remember NOT a functor.
-- ***Not foldable. You never have actual As to turn into ms
-- Pair A B            : an A (footnote: and a B)
-- Not a functor
-- Identity A          : an A (footnote: -left blank by author-)
-- *** Not foldable. Functions are not foldable?
-- Const String A      : an A (footnote: that is ignored and replaced with a fixed string)
-- *** Not foldable. A gets ignored so you never have anything to turn into ms
-- Infinite structure functors are also not foldable

-- 2. Food for thought: a list is called a "persisent data structure" which basically means
--   that when you "mutate it" all the old stuff "persists". The example is that when you
--   "push onto the front of the list" the old list is just in the tail.

--   Persistent data structures are IMMUTABLE and maximize *reuse* of old data.

--   Try to think about: what kind of data structure would allow maximal reuse for a queue?
--   Answer: linked list with head and tail

--   Our list: push front is O(1) and pop front O(1) and push back is O(n) and pop back is O(n).

--   What would work for a set?
--   Haskell uses AVL tree. Balanced binary search tree with subtree heights diff by <= 1. AKA red-black tree.
--   It has O(log n) for insert, delete, and lookup.
--   Hash set can have O(1) lookup, but less persistent
--   Hash array mapped trie (HAMT) is a persistent hash map with O(log n) lookup
--   HAMT hashes the keys (or set elements) and uses bits from the hash as the trie nodes at each level
--   

--   ADVICE: it is 100% ok if you do not reach an answer. It's just meant to be a good exercise
--   to think about the data structures you already know and which ones are or are not good!

--   Things to google/wiki: linked lists, avl trees, red black trees, hash array mapped tries (HAMT),
--     skip lists, finger trees, radix trees.

-- 3. Think about what each of these mean in terms of types:
--   Addition is commutative monoid:
--   a+b = b+a
--   Either A B = Either B A
--   a+0 = a
--   Either A Void = A
--   (a+b)+c = a+(b+c)
--   Either (Either A B) C = Either A (Either B C)

--   Multiplication is a commutative monoid:
--   a*b = b*a
--   (A, B) = (B, A)
--   a*1 = a
--   (A, ()) = A
--   (a*b)*c = a*(b*c)
--   ((A, B), C) = (A, (B, C))
--   0*a = 0
--   (Void, A) = Void

--   Distribution:
--   a*(b+c) = a*b + a*c
--   (A, Either B C) = Either (A, B) (A, C)
--   (a+b)*c = a*c + b*c
--   (Either A B, C) = Either (A, C) (B, C)

--   Exponentials:
--   1^a = 1
--   a -> () = ()
--   a^1 = a
--   () -> a = a
--   a^0 = 1
--   Void -> A = ()
--   a^(b+c) = a^b * a^c
--   Either B C -> A = (B -> A, C -> A)
--   a^(b*c) = (a^b)^c
--   (B, C) -> A = B -> C -> A

--   Challenge: can you say anything intelligent about <, <=, -
--   a < b means there are less instances of a than b
--   a <= b means there are less or equal instances of a than b
--   a - b means instances of a that not in b? if a is a superset of b this is straightforward
--   otherwise it's more like somehow instances of a and b have to map to each other?