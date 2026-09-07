CC ?= cc
CPPFLAGS ?=
CFLAGS ?= -O2 -Wall -Wextra -Werror
all: rms_acl.so
rms_acl.so: rms_acl.c
	$(CC) $(CPPFLAGS) $(CFLAGS) -fPIC -shared -o $@ $<
clean:
	rm -f rms_acl.so
