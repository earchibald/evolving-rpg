# The Manual

How to play the game, what everything in it means, and how to check it all
works — in plain words. The machinery lives in `WALKTHROUGH.md`; nothing in
here needs it.

---

## 1. Start

```bash
cd ~/Code/evolving-rpg
npm run dev        # then open the printed address
```

Your first five minutes: walk into the dark with the arrow keys. Fight the
first thing that finds you by walking into it. Pick up the blade it was
guarding by stepping onto it. Find the stairs. Go down.

The game talks to you constantly in the journal under the map. When in
doubt, read the last three lines — they always say what just happened.

---

## 2. The keys

| Key | What it does |
|---|---|
| arrows / wasd | walk — into a creature is an attack, into a wall costs nothing |
| `.` or space | stand still for a turn |
| `q` | use what your satchel holds |
| `g` | the forge — where new laws are offered and accepted |
| `m` | the gamemaster's screen — everything else lives here |
| `n` | worlds — begin again, start another, wipe everything |
| `r` | begin this world again right away |
| `?` | the keys, on screen |

That is the whole game. Everything else is reading.

---

## 3. Words the game uses

| Word | What it means |
|---|---|
| **world** | one dungeon with its own name, names, laws and dead. Yours is called *main* until you make more |
| **floor** | one level of a world. Nine of them. The first is gentle |
| **the cut** | a floor's shape: *the door* (roomy, kind), *the warren* (tight, loopy), *the halls* (vast, open) |
| **relic** | a thing you wear — blade, charm, boots, lens. Better replaces worse on its own; worse stays on the floor |
| **satchel** | one carried thing, spent with `q`. Walking over another swaps them and leaves the old one lying there |
| **vital draught** | drink it: healed whole, and your health ceiling rises for good. Early or late, never wasted |
| **still smoke** | break it: for a few turns every hunt chases where you *were*. Useless against anything already beside you |
| **warden** | the boss. Stands at the stairs every third floor and will not be drawn far from them. Run away and its wounds close — a boss poked is a boss unpoked |
| **the heart** | what beats at the bottom of the ninth floor. Taking it is not the end — carrying it out is |
| **echo** | one of your past selves, risen. Only at the bottom, only where your bodies lie |
| **the forge** | where a proposed law becomes a real one, or doesn't. Nothing changes without your yes |
| **law** (rule) | a sentence the world now obeys, like *"when you hold still, hurt and alone — you mend."* Laws survive death and follow you downstairs |
| **the bench** | laws proposed and tested while you were away, waiting in the forge for your yes or no |
| **founding** | a new world deciding what it *is* — its story, its words, who its warden is, what it promises. Takes about forty seconds, once |
| **grave** | a run that ended. Kept forever, marked with a **†** in the worlds list |
| **body** | where you fell, still lying there in later runs. Stand on it and that life shows you the floor as it knew it |

---

## 4. How a run goes

**Fight** by walking into things. Hover any number on the right rail and it
explains itself — what you need to roll, what you deal, what it deals.

**Level** by killing. Each level heals you whole and makes you more.

**Gear up.** Every floor guards a relic or two. The guard is the price.

**Carry one thing.** Every floor also leaves one provision lying somewhere
off the path, free — the draught or the smoke. Which one to carry, and when
to spend it, is yours to get wrong.

**Descend** by stepping on the green square. The strongest thing on the
floor watches it. Clear the whole floor first and you descend healed.

**Die** and the world keeps your fall: the run becomes a grave, your body
stays where it dropped, and the world — unasked — reads your death back
and proposes a law about it. Press `r` to rise and go again. Laws and the
world's identity survive; the floors are rebuilt exactly; your body from
last time is lying where you left it.

---

## 5. The four creatures

They do not differ by numbers. They differ by what they *do*:

| Creature | Its move | The tell |
|---|---|---|
| **bruiser** | its blows knock you back a pace, and it lumbers after you | "the blow drives you back a pace" |
| **skirmisher** | crosses two tiles and strikes in one motion — approaching it carelessly *is* the mistake | "it lunges" |
| **stalker** | lies perfectly still, in plain sight, until you come three steps too close. Its first blow lands harder | "it stirs from its stillness" |
| **warden** | holds its post and cannot be lured away. Flee past its leash and it walks home and knits shut | "it resumes its vigil" |

A thing standing eerily still in an open room is not decoration. The rail
says *coiled* next to its name. Believe it.

---

## 6. The bottom

The first floor tells you: **the world runs nine floors deep, and
something beats at the bottom.**

The ninth floor is backwards. The stairs you arrive by are the only way
out, and the heart lies at the far end, behind the last warden. On the
way down, the world drops hints — floors two, five and eight each whisper
one of the world's promises, and each warden's fall confirms one.

Take the heart and everything changes:

- your hands are full — the satchel is sealed until the end,
- every eight turns, the floor raises something against you,
- the first thing it raises is *you*: an echo stands up from every body
  you ever left on that floor, as strong as you are now,
- the way out is the long walk back.

Reach the stairs still carrying it, and the world is **won**.

---

## 7. Why no two worlds feel the same

A new world is *founded*: it decides in one stroke what it is — a drowned
mine, a frost archive — which words it speaks in, who its warden is, and
what it promises you. Every name in it is drawn from that one identity,
and no world ever borrows another's names. Wipe it and the next one will
be someone else entirely.

The gamemaster (`m`, then talk in channel 2) answers from inside the
world's own fiction. The designer (channel 1) answers from outside it.

---

## 8. The forge, plainly

Laws reach you three ways:

1. **Your death proposes one.** Every death is read back; the forge opens
   when the offer lands.
2. **You ask.** After a run ends, press `g` and ask the world for a law.
3. **The bench.** Laws proposed and play-tested while you were away wait
   in the forge. They knock once; refuse them and they stay refused.

Every offer shows the law in a sentence, why it was proposed, and what the
trials made of it — including a warning when a law is heavier than it
looks. **Accept**, **edit** (the form cannot build an illegal law), or
**reject**. Nothing enters the world without your yes, and nothing you
accept escapes the trials: a law that mints strength from repetition, or
makes death impossible, is refused before you ever see it.

---

## 9. Try this — the test guide

Each line is one check. Do the thing; expect the thing. If the game does
something else, that is a finding worth reporting.

| Do | Expect |
|---|---|
| start a fresh world (`n` → wipe) | within a minute: "the world is founded — …" and things start getting real names |
| read the founding (`m` → this world) | a story, a word-list, a named warden, two or three promises |
| walk into a wall | "blocked" — and no turn passes |
| walk into a creature | a to-hit line with real numbers; hover the rail to see the same numbers explained |
| watch a bruiser hit you | you are shoved back a pace and it follows |
| approach a *coiled* thing to three steps | it stirs; its first landed blow is noticeably harder |
| step off, then back onto a floor provision | it swaps with your satchel both times; nothing is ever lost |
| press `q` holding the draught while hurt | healed whole, ceiling raised, one turn spent |
| press `q` holding the smoke mid-chase | pursuers walk to where you *were*; anything adjacent keeps fighting |
| fight the warden, then run five+ steps away | it goes home; its wounds visibly close |
| die | body on the map, a † world in the list, and — unasked — a proposed law arrives within a minute |
| press `r` and walk to where you died | "you stand where you fell" — and the floor that life explored joins your map |
| open the forge on a fresh world | the bench: two waiting laws about rest and the aftermath, each with its trial verdict |
| descend to floor two | a whispered promise in the journal |
| kill the floor-three warden | "the promise holds — …" |
| reach floor nine, take the heart | satchel sealed, waves begin, echoes rise if you ever died there |
| carry it back to the entry stairs | **won** |
| press `v` any time | "chain verified" — the whole history checks out |

---

## 10. When something looks wrong

| It says | It means |
|---|---|
| plain names like "skirmisher" everywhere | the naming model isn't reachable. The game plays on; names arrive when it returns |
| "the worldsmith's offer was refused" | the model wrote a bad founding. The world simply plays unfounded — start another if you want the full voice |
| "no rule this time" | the world read your run and found nothing worth proposing. That is an answer, not an error |
| a queue entry stuck "asking" for minutes | that call failed quietly; reload the tab and it clears. Anything answered is already saved |
| the same world twice feels identical | it is meant to — same world, same floors, forever. *Different* worlds must feel different |

---

*The deeper machinery — how replays, trials, verification and the agent
tooling work — is in `WALKTHROUGH.md` and `AGENTS.md`.*
