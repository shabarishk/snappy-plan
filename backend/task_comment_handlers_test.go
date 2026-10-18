package backend

import (
	"reflect"
	"testing"
)

func TestTaskCommentMentions(t *testing.T) {
	for _, test := range []struct {
		name string
		body string
		want []string
	}{
		{name: "collects distinct usernames case-insensitively", body: "Hi @Alice, @alice and (@bob).", want: []string{"alice", "bob"}},
		{name: "requires a word boundary", body: "email@example.com word@name @bad_name @toolongusername1234567890123456789", want: nil},
		{name: "accepts punctuation before mention", body: "(@owner1) and:@user2", want: []string{"owner1", "user2"}},
		{name: "does not match after unicode word characters", body: "é@user and @élan", want: nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := taskCommentMentions(test.body); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("taskCommentMentions(%q) = %#v, want %#v", test.body, got, test.want)
			}
		})
	}
}
