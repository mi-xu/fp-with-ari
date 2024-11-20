import { cell } from './notebook.ts'

// a stateful computation on input state s
// returns a computed value of type A
// and an updated state of type S
type State<S, A> = (s: S) => [A, S]

// State S is the monad

// pure :: Applicative (State s) => a -> State s a
const statePure: <S, A>(a: A) => State<S, A> = a => s => [a, s]

// transforms a stateful computation
// fmap :: Functor (State s) => (a -> b) -> State s a -> State s b
const stateMap: <S, A, B>(
  f: (a: A) => B, // a function transforming the result value
  sa: State<S, A> // a stateful computation
) => State<S, B> = (f, sa) => s => {
  const [a, ss] = sa(s)
  return [f(a), ss]
}

// (>>=) :: Monad (State s) => (a -> State s b) -> State s a -> State s b
const stateBind: <S, A, B>(
  a2sb: (a: A) => State<S, B>,
  sa: State<S, A>
) => State<S, B> = (a2sb, sa) => s => {
  const [a, ss] = sa(s)
  return a2sb(a)(ss)
}

// (<*>) :: Applicative (State s) -> State s (a -> b) -> State s a -> State s b
const stateApply: <S, A, B>(
  sf: State<S, (a: A) => B>,
  sa: State<S, A>
) => State<S, B> = (sf, sa) => stateBind(f => stateMap(f, sa), sf)

/* in terms of stateMap only
=> s => {
  const [f, s1] = sf(s)
  return stateMap(f, sa)(s1)
}*/

/* raw
=> s => {
  const [f, s1] = sf(s)
  const [a, s2] = sa(s1)
  return [f(a), s2]
}*/

// try playing around with State
cell.disabled(() => {
  const f: State<string, number> = s => {
    const result = s.length
    const ss = s + ' ' + result
    return [result, ss]
  }
  // what is this function f?
  // `State string` is a State Monad
  // `State string number` is an instance of State Monad where the result type is number

  const s0 = 'abc'
  const [a, s1] = f(s0) // the computation only takes a state as input
  const [b, s2] = f(s1)
  console.log(s0)
  console.log(a, s1)
  console.log(b, s2)

  // try using stateMap
  console.log(stateMap(x => x * 2, f)('abc'))
})

cell.disabled(() => {
  const appendStr: (x: string) => State<string, number> = x => s => {
    const ss = s + x
    return [ss.length, ss]
  }

  const repeatAndCount: (n: number) => State<string, number> = n => s => {
    const ss = s.repeat(n)
    return [ss.length, ss]
  }

  // kind of lame if the stateful computation function only takes the state as input
  cell.disabled(() => {
    const s0 = 'hello'
    const [a, s1] = appendStr(' world')(s0)
    const [b, s2] = appendStr('. good')(s1)
    const [c, s3] = appendStr(' night.')(s2)
    console.log(a, s1)
    console.log(b, s2)
    console.log(c, s3)
    // ok this is making a little more sense
    // what does stateMap do?
    console.log(stateMap(x => x * -1, appendStr(' sup'))(s0))
    // still not getting how this is useful
  })

  // what about stateBind?
  cell.disabled(() => {
    const t0 = 'a'
    const [x, t1] = appendStr('b')(t0)
    const [y, t2] = repeatAndCount(x)(t1)
    const [z, t3] = repeatAndCount(y)(t2)

    console.log(x, t1)
    console.log(y, t2)
    console.log(z, t3)
  })

  // rewrite it without needing to manually destructure all the intermediate steps
  cell.disabled(() => {
    const [a, s] = stateBind(
      x => stateBind(y => repeatAndCount(y), repeatAndCount(x)),
      appendStr('b')
    )('a')
    console.log(a, s)
  })

  const flip: <A, B, C>(f: (a: A, b: B) => C) => (b: B, a: A) => C =
    f => (b, a) =>
      f(a, b)
  const g = flip(stateBind)

  const stateBindMultiple: <S, A>(
    sa: State<S, A>,
    fas: ((a: A) => State<S, A>)[]
  ) => State<S, A> = (sa, fas) => fas.reduce(g, sa)

  cell(() => {
    console.log(
      stateBindMultiple(
        appendStr('b'), //
        [
          repeatAndCount, //
          repeatAndCount
        ]
      )('a')
    )
  })
})

// 2. Show that stateApply adheres to the applicative laws

//  pure :: Applicative f => a -> f a
// (<*>) :: Applicative f => f (a -> b) -> f a -> f b

// Identity--------------------------------------------------
// id :: a -> a
// fa :: Applicative f => f a
// pure id <*> fa = fa
/*
(<*>) sf sa = (>>=) (\f -> fmap f sa) sf
(<*>) (pure id) sa = (\f -> fmap f sa) >>= (pure id)
(<*>) (pure id) sa = fmap id sa
(<*>) (pure id) sa = sa
pure id <*> sa = sa QED
*/
cell.disabled(() => {
  // Show by running
  type S = { count: number }
  // couldn't figure out how to type this generically
  // const id: <T>(x: T) => T = x => x
  // S becomes unknown
  // const pureID = statePure(id)
  const id: (x: string) => string = x => x
  const pureID: State<S, (x: string) => string> = statePure(id)
  const fa: State<S, string> = s => ['hi', s]
  const result = stateApply<S, string, string>(pureID, fa)
  console.log(result({ count: 0 }))
  console.log(fa({ count: 0 }))
})

// Homomorphism----------------------------------------------
// f :: a -> b
// x :: a
// pure f <*> pure x = pure (f x)
cell(() => {
  type S = { count: number }
  type A = number
  type B = string
  const f: (x: A) => B = x => x.toString()
  const x: A = 2
  const s: S = { count: 0 }
  console.log(stateApply<S, A, B>(statePure(f), statePure(x))(s))
  console.log(statePure(f(x))(s))
})

// Interchange-----------------------------------------------
//  x :: a
// ff :: Applicative f => f (a -> b)
// ff <*> pure x = pure ($ x) <*> ff

// $ is function application operator
//   ($) :: (a -> b) -> a -> b
// ($ x) :: (a -> b) -> b
// ($ x) f = f x

// order of precedence is like:
// - partially apply y
// - pure the wrapped function
// - do apply with ff
// (pure ($ x)) <*> ff

// $ is "big parens to the end"
// taking advantage of low operator precedence to simplify parens
// f $ g $ h x = f ($ g) ($ h) x = f (g (h x))

// Composition-----------------------------------------------
// (.) :: (b -> c) -> (a -> b) -> (a -> c)
//  fg :: Applicative f => f (b -> c)
//  ff :: Applicative f => f (a -> b)
//  fa :: Applicative f => f a
// pure (.) <*> fg <*> ff <*> fa = fg <*> (ff <*> fa)
