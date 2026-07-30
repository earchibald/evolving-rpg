extends GutTest
## Proves the harness itself runs before anything asks it to prove arithmetic
## about hashes. If this is the only red test, the problem is the runner.


func test_the_lights_are_on() -> void:
	assert_eq(1 + 1, 2)
