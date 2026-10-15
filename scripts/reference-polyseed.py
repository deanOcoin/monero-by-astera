import ctypes as c, hashlib, unicodedata, json
lib=c.CDLL('./work/polyseed-reference.dylib')
R=c.CFUNCTYPE(None,c.c_void_p,c.c_size_t)
P=c.CFUNCTYPE(None,c.c_void_p,c.c_size_t,c.c_void_p,c.c_size_t,c.c_uint64,c.c_void_p,c.c_size_t)
N=c.CFUNCTYPE(c.c_size_t,c.c_char_p,c.c_void_p)
@R
def random(p,n): c.memset(p,0,n)
@R
def zero(p,n): c.memset(p,0,n)
@P
def pbkdf2(p,pn,s,sn,i,k,kn): c.memmove(k,hashlib.pbkdf2_hmac('sha256',c.string_at(p,pn),c.string_at(s,sn),i,kn),kn)
@N
def nfc(p,o):
 b=unicodedata.normalize('NFC',p.decode()).encode();c.memmove(o,b+b'\0',len(b)+1);return len(b)
@N
def nfkd(p,o):
 b=unicodedata.normalize('NFKD',p.decode()).encode();c.memmove(o,b+b'\0',len(b)+1);return len(b)
class Deps(c.Structure): _fields_=[('random',R),('pbkdf2',P),('zero',R),('nfc',N),('nfkd',N),('time',c.c_void_p),('alloc',c.c_void_p),('free',c.c_void_p)]
deps=Deps(random,pbkdf2,zero,nfc,nfkd,None,None,None);lib.polyseed_inject(c.byref(deps))
lib.polyseed_decode.argtypes=[c.c_char_p,c.c_int,c.c_void_p,c.POINTER(c.c_void_p)]
lib.polyseed_keygen.argtypes=[c.c_void_p,c.c_int,c.c_size_t,c.c_void_p]
lib.polyseed_get_birthday.argtypes=[c.c_void_p];lib.polyseed_get_birthday.restype=c.c_uint64
lib.polyseed_crypt.argtypes=[c.c_void_p,c.c_char_p]
lib.polyseed_get_lang.restype=c.c_void_p
lib.polyseed_get_lang_name_en.argtypes=[c.c_void_p];lib.polyseed_get_lang_name_en.restype=c.c_char_p
lib.polyseed_encode.argtypes=[c.c_void_p,c.c_void_p,c.c_int,c.c_void_p]
phrase=b'raven tail swear infant grief assist regular lamp duck valid someone little harsh puppy airport language'
seed=c.c_void_p();assert lib.polyseed_decode(phrase,0,None,c.byref(seed))==0
key=(c.c_ubyte*32)();lib.polyseed_keygen(seed,0,32,key)
order=2**252+27742317777372353535851937790883648493
spend=(int.from_bytes(bytes(key),'little')%order).to_bytes(32,'little').hex()
lib.polyseed_crypt(seed,b'correct horse battery staple')
english=next(lib.polyseed_get_lang(i) for i in range(lib.polyseed_get_num_langs()) if lib.polyseed_get_lang_name_en(lib.polyseed_get_lang(i))==b'English')
out=c.create_string_buffer(576);lib.polyseed_encode(seed,english,0,out)
print(json.dumps({'phrase':phrase.decode(),'spend':spend,'encrypted_phrase':out.value.decode(),'passphrase':'correct horse battery staple'},indent=2))
