#include <algorithm> // Required for std::sort
#include <iostream>
#include <string>
using namespace std;
class Solution {
public:
    bool isAnagram(string s, string t) {
        // compare length of s and that of t
        if (s.length() != t.length()) {
        // if different, return false
            return false;
            }

        // arrange s and t alphabetically
        sort(s.begin(), s.end());
        sort(t.begin(), t.end());

        // loop through s
        for (int i = 0; i < s.length(); i++) {
            if (s[i] != t[i]) {
                return false;
            }
        

        //for each item, if different from that in t, return false
            }
        // after loop ends, return true
        return true;
        
    }
};
